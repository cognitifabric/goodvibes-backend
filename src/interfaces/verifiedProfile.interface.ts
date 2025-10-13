export type VerifiedProfile = {
  provider: "google" | "apple" | "x";
  providerUserId: string;   // Google sub, Apple sub, X user_id
  email?: string;
  emailVerifiedByProvider: boolean;
  firstName?: string;
  lastName?: string;
};