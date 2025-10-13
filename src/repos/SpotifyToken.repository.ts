// src/repos/SpotifyToken.repository.ts
import { injectable } from "inversify";
import { redisClient } from "../infra/redis";

//// INTERFACES
import { SpotifyTokens } from "../interfaces/spotifyTokens.interface";

const KEY_PREFIX = "spotify_tokens:"; // e.g., spotify_tokens:<userId>
// If you want to auto-expire tokens in Redis (not required for refresh_token):
// set to, say, 45 days in seconds. Set to 0 to disable.
const OPTIONAL_TTL_SECONDS = 0;

@injectable()
export default class SpotifyTokenRepository {

  private key(userId: string) {
    return `${KEY_PREFIX}${userId}`;
  }

  async saveTokens(userId: string, tokens: SpotifyTokens) {
    const key = this.key(userId);
    const payload = JSON.stringify(tokens);
    if (OPTIONAL_TTL_SECONDS > 0) {
      await redisClient.set(key, payload, { EX: OPTIONAL_TTL_SECONDS });
    } else {
      await redisClient.set(key, payload);
    }
  }

  async getTokens(userId: string): Promise<SpotifyTokens | undefined> {
    const raw = await redisClient.get(this.key(userId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as SpotifyTokens;
    } catch {
      // if corrupted, drop it
      await redisClient.del(this.key(userId));
      return undefined;
    }
  }

  async updateTokens(userId: string, partial: Partial<SpotifyTokens>) {
    const key = this.key(userId);
    const current = await this.getTokens(userId);
    if (!current) return;

    const merged: SpotifyTokens = { ...current, ...partial };

    if (OPTIONAL_TTL_SECONDS > 0) {
      await redisClient.set(key, JSON.stringify(merged), { EX: OPTIONAL_TTL_SECONDS });
    } else {
      await redisClient.set(key, JSON.stringify(merged));
    }
  }

}