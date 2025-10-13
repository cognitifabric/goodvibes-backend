import "reflect-metadata"
import { Request, Response } from "express"
import { controller, httpGet, httpPost, interfaces } from "inversify-express-utils"
import { SignupSchema } from "../interfaces/signup.interface"
import { VerifiedProfile } from "../interfaces/verifiedProfile.interface"
import { LoginSchema } from "../interfaces/login.interface"
import { makeCodeVerifier, makeCodeChallengeS256, makeState } from "../utils/pkce";
import { redisClient } from "../infra/redis";
import axios from 'axios'


import UserService from "../services/User.service"
import AuthTokenService from "../services/AuthToken.service"
import UserRepository from "../repos/User.repository"

const STATE_PREFIX = "x_oauth_state:";
const STATE_TTL = 10 * 60; // 10 min

@controller("/user")
export default class UserController implements interfaces.Controller {

  constructor(private user: UserService, private auth: AuthTokenService, private userRepo: UserRepository) { }

  @httpPost("/auth/signup")
  async signup(req: Request, res: Response) {

    try {
      const payload = await SignupSchema.parseAsync(req.body);
      const result = await this.user.register(payload);

      return res.status(201).json(result);

    } catch (err: any) {
      console.log("error", err)
      // Map Zod issues
      if (err?.issues) {
        return res.status(400).json({
          error: "ValidationError",
          issues: err.issues.map((i: any) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      // Handle duplicate key from Mongo
      if (err?.code === 11000) {
        const field = Object.keys(err.keyPattern ?? {})[0] ?? "field";
        return res.status(409).json({ error: `${field} already exists` });
      }
      return res.status(400).json({ error: err.message ?? "Sign up failed" });
    }
  }

  // Frontend opens /verify-email?token=... -> FE calls this API; or link directly here and redirect to FE
  @httpGet("/auth/verify-email")
  async verifyEmail(req: Request, res: Response) {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(400).json({ error: "Missing token" });

      const userId = this.auth.verifyEmailVerifyToken(token);
      await this.userRepo.markEmailVerified(userId);

      // Issue session now (cookie)
      const u = await this.auth.issueSessionAfterVerify(userId);
      const jwt = this.auth.makeSessionToken(
        { sub: u.id, username: u.username, plan: u.plan as any },
        u.rememberMe
      );
      this.auth.setSessionCookie(res, jwt, u.rememberMe);

      const frontendUrl = process.env.APP_ORIGIN || "http://localhost:3000";
      // Redirect to dashboard without exposing token in URL
      return res.redirect(`${frontendUrl}/dashboard`);
    } catch (e: any) {
      return res.status(400).json({ error: e.message ?? "Invalid or expired token" });
    }
  }

  @httpPost("/auth/oauth")
  async oauthLogin(req: Request, res: Response) {
    try {
      const { provider, idToken, accessToken, timezone } = req.body as {
        provider: "google" | "apple" | "x";
        idToken?: string;
        accessToken?: string;
        timezone?: string;
      };

      let profile: VerifiedProfile | undefined;

      if (provider === "google") {
        if (!idToken) return res.status(400).json({ error: "Missing idToken" });
        profile = await this.auth.verifyGoogle(idToken);
      } else if (provider === "apple") {
        if (!idToken) return res.status(400).json({ error: "Missing idToken" });
        // profile = await this.auth.verifyApple(idToken, process.env.APPLE_SERVICES_ID!);
      } else if (provider === "x") {
        if (!accessToken) return res.status(400).json({ error: "Missing accessToken" });
        profile = await this.auth.verifyX(accessToken);
      } else {
        return res.status(400).json({ error: "Unsupported provider" });
      }

      if (!profile) return res.status(400).json({ error: "Unable to verify provider profile" });

      const user = await this.auth.upsertFromProvider(profile, new Date(), timezone);

      // If the account isn't email-verified yet, don’t issue a cookie
      if (!user.emailVerified) {
        return res.status(202).json({
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            plan: user.plan,
            emailVerified: false,
          },
          needsEmailVerification: true,
          needsEmailCollection: !user.email || user.email.endsWith("@example.invalid"),
          next:
            !user.email || user.email.endsWith("@example.invalid")
              ? "Please provide an email to verify."
              : "Check your email for a verification link.",
        });
      }

      // Verified → set cookie
      const jwt = this.auth.makeSessionToken(
        { sub: user._id, username: user.username, plan: user.plan },
        true
      );
      this.auth.setSessionCookie(res, jwt, true);

      return res.json({
        ok: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          plan: user.plan,
          emailVerified: true,
          identities: user.identities,
        },
      });
    } catch (err: any) {
      if (err?.issues) return res.status(400).json({ error: "ValidationError", issues: err.issues });
      return res.status(400).json({ error: err.message ?? "OAuth login failed" });
    }
  }

  @httpPost("/auth/login")
  async login(req: Request, res: Response) {
    try {
      const payload = await LoginSchema.parseAsync(req.body);

      // Your helper currently returns { user, token, expiresIn }
      // We will use the token to set the cookie here, and respond with user only.
      const out = await this.auth.login(payload);

      const remember = payload.rememberMe ?? true;
      this.auth.setSessionCookie(res, out.token, remember);

      return res.json({
        ok: true,
        user: out.user,
      });

    } catch (err: any) {
      // your existing error mapping
      const msg: string = err?.message ?? "Login failed";
      if (msg.includes("Invalid credentials")) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (msg.includes("verify your email")) {
        return res.status(403).json({ error: "Please verify your email before signing in." });
      }
      if (msg.includes("Use social login")) {
        return res.status(400).json({ error: "Use social login for this account" });
      }
      return res.status(400).json({ error: msg });
    }
  }

  @httpPost("/auth/logout")
  async logout(_req: Request, res: Response) {
    this.auth.clearSessionCookie(res);
    return res.json({ ok: true });
  }


}