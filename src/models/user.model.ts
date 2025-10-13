// src/models/User.model.ts
import { Schema, model, models, Types } from "mongoose";

export type UserIdentity = {
  provider: "google" | "apple" | "x";
  providerUserId: string;     // sub for Google/Apple; user_id for X
  email?: string;             // what the provider claims
};

export type UserDoc = {
  _id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash?: string;      // <-- make optional
  plan: "free" | "pro";
  spotifyUserId: string | null;
  sets: Types.ObjectId[];
  acceptedTermsAt?: Date;
  marketingOptIn?: boolean;
  timezone?: string;
  rememberMe: boolean;

  // NEW:
  emailVerified: boolean;
  emailVerifiedAt?: Date;
  identities: UserIdentity[];

  createdAt: Date;
  updatedAt: Date;
};

const IdentitySchema = new Schema<UserIdentity>({
  provider: { type: String, enum: ["google", "apple", "x"], required: true },
  providerUserId: { type: String, required: true },
  email: String,
}, { _id: false });

const UserSchema = new Schema<UserDoc>(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    passwordHash: { type: String }, // optional
    plan: { type: String, enum: ["free", "pro"], default: "free" },
    spotifyUserId: { type: String, default: null },
    sets: [{ type: Schema.Types.ObjectId, ref: "Set" }],
    acceptedTermsAt: Date,
    marketingOptIn: { type: Boolean, default: false },
    timezone: String,
    rememberMe: { type: Boolean, default: false },

    // NEW
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: Date,
    identities: { type: [IdentitySchema], default: [] },
  },
  { timestamps: true }
);

export const User = models.User || model<UserDoc>("User", UserSchema);

export default User;
