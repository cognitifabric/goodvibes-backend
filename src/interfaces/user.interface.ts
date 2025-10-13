import { Types } from "mongoose";

export interface IUser {
  _id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  plan: "free" | "pro";
  spotifyUserId: string | null;
  sets: Types.ObjectId[];        // array of Set IDs
  acceptedTermsAt?: Date;
  marketingOptIn?: boolean;
  timezone?: string;
  rememberMe: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreateInput {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  acceptedTermsAt?: Date;
  marketingOptIn?: boolean;
  timezone?: string;
  rememberMe?: boolean;
  emailVerified?: boolean;
};