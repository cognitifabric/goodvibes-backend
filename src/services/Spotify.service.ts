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
  private SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    // playlist scopes needed to create/update/delete (unfollow) temporary playlists
    "playlist-modify-private",
    "playlist-modify-public",
  ].join(" ");

  // You can use cookie/session to persist state per user
  generateState(): string {
    return crypto.randomBytes(12).toString("hex");
  }

  getAuthorizedUrl(state: string, opts?: { showDialog?: boolean }) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      state,
      scope: this.SCOPES,
    });

    if (opts?.showDialog) {
      params.set("show_dialog", "true");
    }

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
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

  // Play either a list of track URIs or a playlist context for a user.
  // Accepts:
  // - userId, and either an array of track URIs (spotify:track:...) or a single playlist URI (spotify:playlist:... or spotify:playlist_v2:...)
  async playUrisForUser(userId: string, urisOrContext: string[] | string, deviceId?: string) {
    const accessToken = await this.ensureAccessToken(userId);

    // pick a device if none provided
    let targetDeviceId = deviceId;
    if (!targetDeviceId) {
      const devicesResp = await fetch("https://api.spotify.com/v1/me/player/devices", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!devicesResp.ok) {
        const text = await devicesResp.text().catch(() => "");
        throw new Error(`Failed to query devices: ${devicesResp.status} ${text}`);
      }
      const devicesBody = await devicesResp.json().catch(() => ({ devices: [] }));
      const available = (devicesBody.devices || []) as any[];
      if (!available.length) throw new Error("No active Spotify devices");
      targetDeviceId = available[0].id;
    }

    const playUrl = `https://api.spotify.com/v1/me/player/play${targetDeviceId ? `?device_id=${encodeURIComponent(targetDeviceId)}` : ""}`;

    // Decide whether to use context_uri (playlist/album/artist) or uris (track URIs)
    let body: any;
    const toStr = (s: string) => s ?? "";
    const looksLikePlaylist = (s: string) =>
      toStr(s).startsWith("spotify:playlist:") || toStr(s).startsWith("spotify:playlist_v2:") || toStr(s).includes(":playlist_v2:");

    if (typeof urisOrContext === "string") {
      if (looksLikePlaylist(urisOrContext)) {
        body = { context_uri: urisOrContext.replace("spotify:playlist_v2:", "spotify:playlist:") };
      } else {
        body = { uris: [urisOrContext] };
      }
    } else if (Array.isArray(urisOrContext) && urisOrContext.length === 1 && looksLikePlaylist(urisOrContext[0])) {
      // single playlist URI passed in array
      body = { context_uri: urisOrContext[0].replace("spotify:playlist_v2:", "spotify:playlist:") };
    } else {
      body = { uris: urisOrContext };
    }

    const playResp = await fetch(playUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (![204, 202, 200].includes(playResp.status)) {
      const details = await playResp.text().catch(() => "");
      const err: any = new Error(`Spotify play failed: ${playResp.status} ${details}`);
      err.status = playResp.status;
      err.details = details;
      throw err;
    }

    return { ok: true, deviceId: targetDeviceId };
  }

}