import crypto from "crypto";

export function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function makeCodeVerifier() {
  // 43-128 chars. Base64url ok.
  return randomString(48);
}

export function makeCodeChallengeS256(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function makeState() {
  return randomString(24);
}
