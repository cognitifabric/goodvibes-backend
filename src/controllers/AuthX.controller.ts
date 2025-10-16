// src/controllers/AuthX.controller.ts (or inside UserController if you prefer)
import "reflect-metadata";
import axios from "axios";
import { injectable } from "inversify";
import { Request, Response } from "express";
import { controller, httpGet, httpPost, interfaces } from "inversify-express-utils";
import { redisClient } from "../infra/redis";
import { makeCodeVerifier, makeCodeChallengeS256, makeState } from "../utils/pkce";

import AuthTokenService from "../services/AuthToken.service";

const STATE_PREFIX = "x_oauth_state:";
const STATE_TTL = 10 * 60; // 10 min

@controller("/user/auth/x")
export default class AuthXController implements interfaces.Controller {
  constructor(private auth: AuthTokenService) { }

  // Frontend calls this to get an authorize URL (and we store PKCE+state in Redis)
  @httpPost("/start")
  async start(req: Request, res: Response) {

    const {
      redirect = process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN}/oauth/x/callback` : "http://localhost:3000/oauth/x/callback",
    } = (req.body ?? {}) as { redirect?: string };

    const clientId = process.env.X_CLIENT_ID!;
    const redirectUri = process.env.X_REDIRECT_URI!;
    const scope = ["tweet.read", "users.read", "offline.access"].join(" ");

    const state = makeState();
    const codeVerifier = makeCodeVerifier();
    const codeChallenge = makeCodeChallengeS256(codeVerifier);

    // persist verifier + where to send the user back (your FE)
    await redisClient.set(
      `${STATE_PREFIX}${state}`,
      JSON.stringify({ codeVerifier, redirect }),
      { EX: STATE_TTL, NX: true }
    );

    const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return res.json({ authorizeUrl: authUrl.toString() });
  }

  // X redirects here with ?state & ?code
  @httpGet("/callback")
  async callback(req: Request, res: Response) {

    console.log('query', req.query)

    try {
      const { state, code, error, error_description } = req.query as any;
      if (error) return res.status(400).send(`X error: ${error}, ${error_description || ""}`);
      if (!state || !code) return res.status(400).send("Missing state or code");

      const key = `${STATE_PREFIX}${state}`;
      const json = await redisClient.get(key);
      if (!json) return res.status(400).send("Invalid or expired state");
      await redisClient.del(key);

      const { codeVerifier, redirect } = JSON.parse(json) as { codeVerifier: string; redirect: string };

      // Exchange code -> tokens
      const tokenUrl = "https://api.twitter.com/2/oauth2/token";
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");
      body.set("client_id", process.env.X_CLIENT_ID!);
      body.set("code_verifier", codeVerifier);
      body.set("code", String(code));
      body.set("redirect_uri", process.env.X_REDIRECT_URI!);

      const basic = Buffer.from(`${process.env.X_CLIENT_ID!}:${process.env.X_CLIENT_SECRET!}`, "utf8").toString("base64");

      const tokenResp = await axios.post(tokenUrl, body.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basic}`,
        },
      });

      const { access_token /*, refresh_token, expires_in, scope, token_type */ } = tokenResp.data || {};
      if (!access_token) return res.status(400).send("No access_token from X");

      // Get user profile
      const meResp = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { "user.fields": "name,username,profile_image_url" },
      });

      const me = meResp.data?.data;
      if (!me?.id) return res.status(400).send("Failed to fetch X user profile");

      // Build a VerifiedProfile for your upsert flow
      const name = (me.name || "").trim();
      const [first, ...rest] = name.split(" ");
      const last = rest.join(" ");

      const profile = {
        provider: "x" as const,
        providerUserId: me.id,
        email: undefined,                 // X doesn't return email here
        emailVerifiedByProvider: false,
        firstName: first || "",
        lastName: last || "",
      };

      const user = await this.auth.upsertFromProvider(profile, new Date());

      // If user isn’t email-verified (likely, since X provides no email), ask FE to collect email/verify.
      if (!user.emailVerified) {
        // Don’t set session cookie. Redirect back with state for FE to act on.
        const dest = new URL(redirect || process.env.APP_ORIGIN || "http://localhost:3000");
        dest.pathname = "/login";
        dest.searchParams.set("notice", "needs-email");
        // You might pass a short-lived token that only allows adding email+verify if you want.
        return res.redirect(dest.toString());
      }

      // User verified → issue httpOnly cookie and send home
      const jwt = this.auth.makeSessionToken(
        { sub: user._id, username: user.username, plan: user.plan },
        true
      );
      this.auth.setSessionCookie(res, jwt, true);

      const dest = new URL(redirect || process.env.APP_ORIGIN || "http://localhost:3000");
      dest.pathname = "/dashboard";
      return res.redirect(dest.toString());

    } catch (e: any) {
      console.error("[X OAuth callback] error:", e?.response?.data || e);
      return res.status(400).send(e?.message || "X OAuth failed");
    }
  }
}
