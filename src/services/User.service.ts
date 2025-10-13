import "reflect-metadata"
import { injectable } from "inversify"
import { SignupInput } from "../interfaces/signup.interface"
import { VerifiedProfile } from "../interfaces/verifiedProfile.interface"
import bcrypt from "bcryptjs"
import UserRepository from "../repos/User.repository"
import AuthTokenService from "./AuthToken.service"
import EmailService from "./Email.service"

@injectable()
export default class UserService {

  // userRepository property is a dependency
  constructor(public readonly users: UserRepository, private tokens: AuthTokenService, private email: EmailService) { }

  async register(input: SignupInput) {
    // uniqueness checks
    if (await this.users.findByEmail(input.email.toLowerCase())) {
      throw new Error("Email already in use");
    }

    if (await this.users.findByUsername(input.username)) {
      throw new Error("Username already in use");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.users.create({
      username: input.username,
      email: input.email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      acceptedTermsAt: input.acceptedTermsAt ?? new Date(), // or enforce explicit consent
      marketingOptIn: input.marketingOptIn,
      timezone: input.timezone,
      rememberMe: input.rememberMe ?? false,
      emailVerified: false
    });

    // build verify link
    const verifyToken = this.tokens.makeEmailVerifyToken(user._id.toString());
    const appOrigin = process.env.APP_ORIGIN || "http://localhost:3001";
    // You can point directly to your API endpoint and redirect to frontend after success.
    const link = `${appOrigin}/api/user/auth/verify-email?token=${verifyToken}`;

    // send email
    await this.email.sendVerificationEmail(user.email, link)

    // Return a 202-style payload hinting next step — no session token yet.
    return {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        plan: user.plan,
        emailVerified: false,
      },
      next: "Check your email to verify your account.",
    };
  }

  async setSpotifyUserId(appUserId: string, spotifyUserId: string) {
    await this.users.updateById(appUserId, { spotifyUserId });
  }

  async ensureSpotifyId(appUserId: string, spotifyUserId: string) {
    const u = await this.users.findById(appUserId);

    if (!u?.spotifyUserId || u.spotifyUserId !== spotifyUserId) {
      await this.setSpotifyUserId(appUserId, spotifyUserId);
    }

  }

}