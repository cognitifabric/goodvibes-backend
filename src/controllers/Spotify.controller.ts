import "reflect-metadata"
import { Request, Response } from "express"
import { controller, httpGet, httpPost, interfaces } from "inversify-express-utils"
import UserService from "../services/User.service"
import SpotifyService from "../services/Spotify.service"
import SpotifyTokenRepository from "../repos/SpotifyToken.repository"
import { redisClient } from "../infra/redis"; // import singleton
import { AuthMiddleware } from "../middleware/Auth.middleware";

//// INTERFACES
import { SpotifySearchSchema } from "../interfaces/search.interface";


const STATE_PREFIX = "spotify_state:";
const STATE_TTL = 600; // 10 minute
// NOTE: temporary playlist / queue logic moved to Set.controller to keep set-related actions together.

@controller("/account")
export default class SpotifyController implements interfaces.Controller {

  constructor(public readonly user: UserService, public readonly spotify: SpotifyService, public readonly tokensRepo: SpotifyTokenRepository) { }

  // Allow POST when frontend wants to send user info (id/username) in the body
  @httpPost("/authorize/spotify", AuthMiddleware)
  async spotifyAuthorizationPost(req: Request, res: Response) {

    // Prefer authenticated user id (set by AuthMiddleware), then body/query.
    // Don't fall back to an arbitrary demo id that will break DB operations.
    const bodyUserId = (req.body && (req.body.id || req.body.username)) as string | undefined;
    const authUserId = (req as any).user?.id as string | undefined;
    const userId = authUserId ?? bodyUserId ?? (req.query.userId as string | undefined);

    if (!userId) {
      // client should be authenticated or include a valid userId
      return res.status(400).json({ error: "Missing user id for Spotify authorization" });
    }

    const state = this.spotify.generateState() + ":" + userId;

    // Store state in Redis instead of cookie
    await redisClient.set(`${STATE_PREFIX}${state}`, userId, {
      EX: STATE_TTL, // TTL (expire automatically)
      NX: true,      // only set if not exists
    });

    // allow forcing consent: accept showDialog in body or query
    const showDialog =
      (req.body && (req.body.showDialog === true || req.body.showDialog === "true")) ||
      (req.query && (req.query.showDialog === "true" || req.query.show_dialog === "true" || req.query.showDialog === "1"));

    const url = this.spotify.getAuthorizedUrl(state, { showDialog: !!showDialog });

    // If the request is an XHR (frontend requesting JSON) or explicitly asks for JSON, return the URL
    const isXhr = (req.headers["x-requested-with"] as string | undefined) === "XMLHttpRequest" || (req.headers.accept || "").includes("application/json");
    if (isXhr || req.headers["user-agent"]?.includes("Postman")) {
      return res.json({ authorizeUrl: url });
    }

    return res.redirect(url);
  }

  // Step 2: Spotify redirects here with ?code=...&state=...
  @httpGet("/authorize/spotify/callback")
  async spotifyCallback(req: Request, res: Response) {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    const isXhr = (req.headers["x-requested-with"] as string | undefined) === "XMLHttpRequest" || (req.headers.accept || "").includes("application/json");

    const FRONTEND = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

    if (error) {
      if (isXhr) return res.status(400).json({ error });
      return res.redirect(`${FRONTEND}/dashboard?spotify=error&message=${encodeURIComponent(String(error))}`);
    }

    if (!state) {
      if (isXhr) return res.status(400).json({ error: "Missing state" });
      return res.redirect(`${FRONTEND}/dashboard?spotify=error&message=${encodeURIComponent("Missing state")}`);
    }

    // Atomically consume state from Redis
    const key = `${STATE_PREFIX}${state}`;
    const appUserId = await redisClient.get(key);
    await redisClient.del(key); // one-time use

    if (!appUserId) {
      if (isXhr) return res.status(400).json({ error: "Invalid or expired state" });
      return res.redirect(`${FRONTEND}/dashboard?spotify=error&message=${encodeURIComponent("Invalid or expired state")}`);
    }

    try {

      // 1) exchange code -> tokens (access + refresh + expires_at)
      const tokens = await this.spotify.exchangeCodeForTokens(code!);

      // persist tokens under the appUserId
      await this.tokensRepo.saveTokens(appUserId, tokens);

      // VERIFY: read back tokens immediately and log diagnostic info to ensure key matches
      try {
        const savedTokens = await this.tokensRepo.getTokens(appUserId);
        console.log("spotifyCallback: saved tokens for", appUserId, savedTokens ? "OK" : "MISSING");
      } catch (vErr) {
        console.error("spotifyCallback: failed to verify saved tokens for", appUserId, vErr);
      }

      // 2) fetch Spotify /me with the fresh access token
      const me = await this.spotify.getCurrentUserProfile(tokens.access_token);

      // 3) persist spotifyUserId on our user
      await this.user.setSpotifyUserId(appUserId, me.id);

      if (isXhr) {
        return res.json({ message: "Spotify linked", userId: appUserId, spotifyUserId: me.id });
      }

      // Redirect browser back to the frontend dashboard with a success indicator
      const redirectUrl = `${FRONTEND}/dashboard?spotify=success&userId=${encodeURIComponent(appUserId)}&spotifyUserId=${encodeURIComponent(me.id)}`;
      return res.redirect(redirectUrl);

    } catch (e: any) {

      console.log("ERROR exchanging code", e);
      const msg = e?.message ?? "Token exchange failed";
      if (isXhr) return res.status(500).json({ error: msg });
      return res.redirect(`${FRONTEND}/dashboard?spotify=error&message=${encodeURIComponent(String(msg))}`);

    }

  }

  // protected /spotify/me that also keeps DB in sync
  @httpGet("/spotify/me", AuthMiddleware)
  async spotifyMe(req: Request, res: Response) {

    const appUserId = req.user!.id;
    try {
      // First check whether tokens exist in storage for this user.
      // If no tokens are present, return 200 with tokenInfo: null so the frontend
      // can show "not connected" without treating this as a hard 401.
      const stored = await this.tokensRepo.getTokens(appUserId);
      if (!stored) {
        console.log("spotifyMe: no stored tokens for", appUserId);
        return res.json({ profile: null, tokenInfo: null });
      }

      const accessToken = await this.spotify.ensureAccessToken(appUserId);
      const me = await this.spotify.getCurrentUserProfile(accessToken);

      // Read stored token metadata (no tokens returned)
      const tokens = await this.tokensRepo.getTokens(appUserId);
      const tokenInfo = tokens
        ? { expiresAt: (tokens as any).expires_at ?? null }
        : null;

      // keep DB spotifyUserId synced if changed
      await this.user.ensureSpotifyId(appUserId, me.id);

      return res.json({ profile: me, tokenInfo });

    } catch (e: any) {
      console.log(e)
      // If ensureAccessToken failed, surface 401 otherwise return error message
      return res.status(401).json({ error: e.message ?? "Unauthorized" });
    }
  }


  @httpPost("/spotify/search", AuthMiddleware)
  async searchTracks(req: Request, res: Response) {

    try {
      const body = await SpotifySearchSchema.parseAsync(req.body);
      const appUserId = req.user!.id; // from AuthMiddleware
      const result = await this.spotify.searchTracks(appUserId, body);

      // console.log("Spotify search result", result);

      return res.json(result);
    } catch (err: any) {

      console.log("error", err)

      if (err?.issues) {
        return res.status(400).json({
          error: "ValidationError",
          issues: err.issues.map((i: any) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      return res.status(400).json({ error: err.message ?? "Search failed" });
    }
  }


  @httpPost("/spotify/play", AuthMiddleware)
  async playTrack(req: Request, res: Response) {
    try {
      const { trackId, deviceId } = req.body as { trackId?: string; deviceId?: string };
      if (!trackId) return res.status(400).json({ error: "Missing trackId" });

      const appUserId = req.user!.id;
      // ensure we have a valid access token (service will refresh if needed)
      const accessToken = await this.spotify.ensureAccessToken(appUserId);

      let targetDeviceId = deviceId;

      // If no device specified, try to find one
      if (!targetDeviceId) {
        const devicesResp = await fetch("https://api.spotify.com/v1/me/player/devices", {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });

        if (!devicesResp.ok) {
          const text = await devicesResp.text().catch(() => "");
          return res.status(502).json({ error: "Failed to query Spotify devices", details: text });
        }

        const devicesBody = await devicesResp.json().catch(() => ({ devices: [] }));
        const available = (devicesBody.devices || []) as any[];

        if (!available.length) {
          return res.status(404).json({
            error: "No active Spotify devices",
            message: "Open Spotify on a device (phone/desktop) or pass a deviceId to target.",
          });
        }
        targetDeviceId = available[0].id;
      }

      // Start playback on the target device
      // targetDeviceId is guaranteed to be set above (we returned 404 if none),
      // use non-null assertion to satisfy TypeScript
      const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDeviceId!)}`;
      const playResp = await fetch(playUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      });

      if (![204, 202, 200].includes(playResp.status)) {
        const details = await playResp.text().catch(() => "");
        return res.status(playResp.status).json({ error: "Spotify play failed", details });
      }

      return res.json({ ok: true, deviceId: targetDeviceId });
    } catch (err: any) {
      console.error("playTrack error", err);
      return res.status(500).json({ error: err?.message ?? "Internal Server Error" });
    }
  }

}