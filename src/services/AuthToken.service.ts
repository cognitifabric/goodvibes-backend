// src/services/AuthToken.service.ts
import jwt from "jsonwebtoken";
import axios from 'axios'
import bcrypt from "bcryptjs"
import { injectable } from "inversify";
import { Response } from "express";
import { VerifiedProfile } from "../interfaces/verifiedProfile.interface"
import { LoginInput } from "../interfaces/login.interface";

import UserRepository from "../repos/User.repository"

@injectable()
export default class AuthTokenService {

  constructor(private readonly users: UserRepository) { }

  private secret = process.env.JWT_SECRET || "dev-secret";

  makeEmailVerifyToken(userId: string) {
    return jwt.sign({ purpose: "email_verify" }, this.secret, {
      subject: userId,
      expiresIn: "24h",
    });
  }

  verifyEmailVerifyToken(token: string): string {
    const payload = jwt.verify(token, this.secret) as any;
    if (payload.purpose !== "email_verify") throw new Error("Bad token purpose");
    return payload.sub as string; // userId
  }

  makeSessionToken(payload: { sub: string; username: string; plan: string }, remember = false) {
    return jwt.sign(payload, this.secret, { expiresIn: remember ? "30d" : "7d" });
  }

  async issueSessionAfterVerify(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new Error("User not found");
    if (!user.emailVerified) throw new Error("Email not verified");

    // Don’t return a raw token for the FE anymore; controller will set the cookie.
    return {
      id: user._id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      plan: user.plan,
      rememberMe: user.rememberMe ?? true,
    };
  }

  setSessionCookie(res: Response, token: string, remember = true) {
    const maxAge = remember ? 30 * 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
    const cookieOpts: any = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      samesite: "none",
      domain: process.env.APP_ORIGIN ?? undefined,
      maxAge,
      path: "/",
    };
    // allow overriding domain / samesite via env in production
    cookieOpts.sameSite = process.env.COOKIE_SAMESITE ?? (process.env.NODE_ENV === "production" ? "none" : "lax");
    if (process.env.APP_ORIGIN) cookieOpts.domain = process.env.APP_ORIGIN;
    res.cookie("gv_session", token, cookieOpts);
  }

  clearSessionCookie(res: Response) {
    const opts: any = { path: "/" };
    if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
    res.clearCookie("gv_session", opts);
  }

  verify(token: string) {
    return jwt.verify(token, this.secret);
  }

  async verifyGoogle(idToken: string): Promise<VerifiedProfile> {
    // simplest: tokeninfo call (or use google-auth-library for signatures)
    const { data } = await axios.get("https://oauth2.googleapis.com/tokeninfo", {
      params: { id_token: idToken },
    });

    if (process.env.GOOGLE_OAUTH_CLIENT_ID && data.aud !== process.env.GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error("Invalid Google audience");
    }

    return {
      provider: "google",
      providerUserId: data.sub,
      email: data.email,
      emailVerifiedByProvider: data.email_verified === "true" || data.email_verified === true,
      firstName: data.given_name,
      lastName: data.family_name,
    };
  }

  // This is where we SAVE to user.identities[]
  async upsertFromProvider(p: VerifiedProfile, termsAcceptedAt?: Date, timezone?: string) {
    // If already linked by provider
    const byIdentity = await this.users.findByIdentity(p.provider, p.providerUserId);
    if (byIdentity) return byIdentity;

    // If account exists by email, link identity to that user
    if (p.email) {
      const byEmail = await this.users.findByEmail(p.email.toLowerCase());
      if (byEmail) {
        await this.users.addIdentity(byEmail._id, {
          provider: p.provider,
          providerUserId: p.providerUserId,
          email: p.email,
        });
        if (p.emailVerifiedByProvider && !byEmail.emailVerified) {
          await this.users.markEmailVerified(byEmail._id);
        }
        return await this.users.findById(byEmail._id);
      }
    }

    // Else create a new user (username allocation + identities[])
    const base = (p.firstName || p.email?.split("@")[0] || `${p.provider}_${p.providerUserId.slice(-6)}`)?.toLowerCase().replace(/[^a-z0-9_]+/g, "") || "user";

    const username = await this.users.allocateUsername(base);

    const created = await this.users.create({
      username,
      email: (p.email ?? `${p.provider}_${p.providerUserId}@example.invalid`).toLowerCase(),
      firstName: p.firstName ?? "",
      lastName: p.lastName ?? "",
      passwordHash: undefined,                     // social-only account
      acceptedTermsAt: termsAcceptedAt ?? new Date(),
      marketingOptIn: false,
      timezone,
      emailVerified: p.emailVerifiedByProvider,    // <- trust Google/Apple
      identities: [{                               // <- SAVED HERE
        provider: p.provider,
        providerUserId: p.providerUserId,
        email: p.email,
      }],
    });

    return created;
  }

  async login(input: LoginInput) {
    const email = input.email.toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new Error("Invalid credentials");
    }

    // If the account was created via social (no passwordHash), block password login.
    if (!user.passwordHash) {
      throw new Error("Use social login for this account");
    }

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new Error("Invalid credentials");
    }

    // Enforce email verification
    if (!user.emailVerified) {
      throw new Error("Please verify your email before signing in");
    }

    const remember = input.rememberMe ?? true;
    const expiresIn = remember ? "30d" : "7d";

    const token = this.makeSessionToken({ sub: user._id, username: user.username, plan: user.plan }, remember)

    return {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        plan: user.plan,
        emailVerified: user.emailVerified,
      },
      token,
      expiresIn,
    };
  }

  async verifyX(accessToken: string) {
    const meResp = await axios.get("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { "user.fields": "name,username,profile_image_url" },
    });

    const me = meResp.data?.data;
    if (!me?.id) throw new Error("Cannot verify X access token");

    const name = (me.name || "").trim();
    const [first, ...rest] = name.split(" ");
    const last = rest.join(" ");

    return {
      provider: "x" as const,
      providerUserId: me.id,
      email: undefined,                  // X doesn't return email in v2
      emailVerifiedByProvider: false,
      firstName: first || "",
      lastName: last || "",
    };
  }


}
