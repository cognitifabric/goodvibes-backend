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
const STATE_TTL = 600; // 10 minutes

@controller("/account")
export default class SpotifyController implements interfaces.Controller {

  constructor(public readonly user: UserService, public readonly spotify: SpotifyService, public readonly tokensRepo: SpotifyTokenRepository) { }

  // Step 1: redirect the user to Spotify
  @httpGet("/authorize/spotify", AuthMiddleware)
  async spotifyAuthorization(req: Request, res: Response) {

    // In a real app, use your authenticated app user id. For demo:
    const userId = (req.query.userId as string) || "demo-user-123";
    const state = this.spotify.generateState() + ":" + userId;

    // Store state in Redis instead of cookie
    await redisClient.set(`${STATE_PREFIX}${state}`, userId, {
      EX: STATE_TTL, // TTL (expire automatically)
      NX: true,      // only set if not exists
    });

    const url = this.spotify.getAuthorizedUrl(state);
    // For Postman, you can return the URL; for browser, redirect:
    if (req.headers["user-agent"]?.includes("Postman")) {
      return res.json({ authorize_url: url });
    }

    return res.redirect(url);

  }

  // Step 2: Spotify redirects here with ?code=...&state=...
  @httpGet("/authorize/spotify/callback")
  async spotifyCallback(req: Request, res: Response) {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error) return res.status(400).json({ error });
    if (!state) return res.status(400).json({ error: "Missing state" });

    // Atomically consume state from Redis
    const key = `${STATE_PREFIX}${state}`;
    const appUserId = await redisClient.get(key);
    await redisClient.del(key); // one-time use
    if (!appUserId) return res.status(400).json({ error: "Invalid or expired state" });

    try {

      // 1) exchange code -> tokens (access + refresh + expires_at)
      const tokens = await this.spotify.exchangeCodeForTokens(code!);
      await this.tokensRepo.saveTokens(appUserId, tokens);

      // 2) fetch Spotify /me with the fresh access token
      const me = await this.spotify.getCurrentUserProfile(tokens.access_token);

      // 3) persist spotifyUserId on our user
      await this.user.setSpotifyUserId(appUserId, me.id);

      console.log("Spotify linked", { appUserId, spotifyUserId: me.id });

      return res.json({ message: "Spotify linked", userId: appUserId, spotifyUserId: me.id });

    } catch (e: any) {

      console.log("ERROR exchanging code", e);
      return res.status(500).json({ error: e.message ?? "Token exchange failed" });

    }

  }

  // protected /spotify/me that also keeps DB in sync
  @httpGet("/spotify/me", AuthMiddleware)
  async spotifyMe(req: Request, res: Response) {
    const appUserId = req.user!.id;
    try {
      const accessToken = await this.spotify.ensureAccessToken(appUserId);
      const me = await this.spotify.getCurrentUserProfile(accessToken);

      // keep DB spotifyUserId synced if changed
      await this.user.ensureSpotifyId(appUserId, me.id);

      return res.json(me);
    } catch (e: any) {
      return res.status(401).json({ error: e.message ?? "Unauthorized" });
    }
  }


  @httpPost("/spotify/search", AuthMiddleware)
  async searchTracks(req: Request, res: Response) {
    try {
      const body = await SpotifySearchSchema.parseAsync(req.body);
      const appUserId = req.user!.id; // from AuthMiddleware
      const result = await this.spotify.searchTracks(appUserId, body);
      return res.json(result);
    } catch (err: any) {
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

}