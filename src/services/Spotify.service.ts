import "reflect-metadata";
import { injectable, inject } from "inversify";
import axios from "axios";
import crypto from "crypto";
import SpotifyTokenRepository from "../repos/SpotifyToken.repository";

//// INTERFACES
import { SpotifyTokens } from "../interfaces/spotifyTokens.interface";
import { ISpotifySearchInput } from "../interfaces/search.interface";

@injectable()
export default class SpotifyService {

  constructor(private repo: SpotifyTokenRepository) { }

  private clientId = process.env.SPOTIFY_CLIENT_ID!;
  private clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  private redirectUri = process.env.SPOTIFY_REDIRECT_URI!;
  private scopes = (process.env.SPOTIFY_SCOPES ?? "user-read-email user-read-private").split(" ");

  // You can use cookie/session to persist state per user
  generateState(): string {
    return crypto.randomBytes(12).toString("hex");
  }

  getAuthorizedUrl(state: string) {

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      scope: this.scopes.join(" "),
      redirect_uri: this.redirectUri,
      state,
    });

    return `${process.env.SPOTIFY_ACCOUNTS}/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });

    const { data } = await axios.post(
      `${process.env.SPOTIFY_ACCOUNTS}/api/token`,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
        },
      }
    );

    const now = Date.now();
    const tokens: SpotifyTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      scope: data.scope,
      expires_at: now + data.expires_in * 1000,
    };
    return tokens;
  }

  async ensureAccessToken(userId: string): Promise<string> {
    const tokens = await this.repo.getTokens(userId);
    if (!tokens) throw new Error("No tokens stored for user");

    // Refresh if < 60s left
    if (Date.now() > (tokens.expires_at - 60_000)) {
      const refreshed = await this.refreshAccessToken(tokens.refresh_token);
      await this.repo.updateTokens(userId, refreshed);
      return refreshed.access_token!;
    }
    return tokens.access_token;
  }

  async refreshAccessToken(refreshToken: string) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const { data } = await axios.post(
      `${process.env.SPOTIFY_ACCOUNTS}/api/token`,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
        },
      }
    );

    const now = Date.now();
    return {
      access_token: data.access_token as string,
      // Spotify may not always return a new refresh_token:
      refresh_token: data.refresh_token ?? refreshToken,
      token_type: data.token_type,
      scope: data.scope,
      expires_at: now + data.expires_in * 1000,
    } as Partial<SpotifyTokens>;
  }

  async getCurrentUserProfile(accessToken: string) {
    const { data } = await axios.get(`${process.env.SPOTIFY_API}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data;
  }

  async searchTracks(userId: string, input: ISpotifySearchInput) {
    const accessToken = await this.ensureAccessToken(userId);

    const params = new URLSearchParams({
      q: input.query,
      type: "track",
      limit: String(input.limit ?? 10),
    });
    if (input.market) params.set("market", input.market);

    const { data } = await axios.get(`${process.env.SPOTIFY_API}/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // normalize...
    return data;
  }

}