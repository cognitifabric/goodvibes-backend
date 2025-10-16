// src/controllers/Set.controller.ts
import "reflect-metadata";
import { Request, Response } from "express";
import { controller, httpPost, httpDelete, httpPatch, interfaces } from "inversify-express-utils";
import { AuthMiddleware } from "../middleware/Auth.middleware";
import SetService from "../services/Set.service";
import SpotifyService from "../services/Spotify.service";
import { redisClient } from "../infra/redis";

//// SCHEMAS AND INTERFACES
import { CreateSetSchema } from "../interfaces/set.interface";
import { AddSongsSchema } from "../interfaces/setEdit.interface";
import { ReplaceSongsSchema } from "../interfaces/replaceSongs.interface";
import { UpdateSetSchema } from "../interfaces/set.update.interface";

type RemoveSongsBody = { songs: string[] };

const TEMP_PLAYLIST_PREFIX = "spotify_temp_playlist:"; // per-app-user temp playlist id (Redis)
const TEMP_PLAYLIST_TTL = 60 * 60 * 6; // 6 hours

@controller("/sets")
export default class SetController implements interfaces.Controller {
  constructor(private set: SetService, private spotify: SpotifyService) { }

  @httpPost("/create", AuthMiddleware)
  async create(req: Request, res: Response) {

    try {
      // ensure the authenticated user is set as the creator before validating
      const creatorId = req.user!.id;
      const bodyToValidate = { ...(req.body || {}), createdBy: creatorId };
      const body = await CreateSetSchema.parseAsync(bodyToValidate);
      const created = await this.set.createSet(creatorId, body);

      return res.status(201).json(created);

    } catch (err: any) {
      console.log(err)
      if (err?.issues) {
        return res.status(400).json({
          error: "ValidationError",
          issues: err.issues.map((i: any) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      return res.status(400).json({ error: err.message ?? "Create set failed" });
    }

  }

  @httpPost("/:setId/songs", AuthMiddleware)
  async addSongs(req: Request, res: Response) {

    try {
      const body = await AddSongsSchema.parseAsync(req.body);
      const { setId } = req.params;
      const userId = req.user!.id;
      console.log("Adding songs", { setId, userId, songs: body.songs });
      const result = await this.set.addSongs(setId, userId, body.songs);
      res.json(result);
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ error: "ValidationError", issues: err.issues });
      }
      const status = err?.message === "Forbidden" ? 403 : err?.message === "Set not found" ? 404 : 400;
      return res.status(status).json({ error: err.message ?? "Add songs failed" });
    }

  }

  @httpPatch("/:setId/songs", AuthMiddleware)
  async replaceSongs(req: Request, res: Response) {
    try {
      const body = await ReplaceSongsSchema.parseAsync(req.body);
      const { setId } = req.params;
      const userId = req.user!.id;

      const result = await this.set.replaceSongs(setId, userId, body.songs);
      res.json(result);
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ error: "ValidationError", issues: err.issues });
      }
      const status = err?.message === "Forbidden" ? 403 : err?.message === "Set not found" ? 404 : 400;
      return res.status(status).json({ error: err.message ?? "Replace songs failed" });
    }
  }

  @httpPatch("/:setId", AuthMiddleware)
  async updateBasic(req: Request, res: Response) {
    try {
      const body = await UpdateSetSchema.parseAsync(req.body);
      const { setId } = req.params;
      const userId = req.user!.id;

      const updated = await this.set.updateSetBasic(setId, userId, body);
      return res.json(updated);
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({
          error: "ValidationError",
          issues: err.issues.map((i: any) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const status =
        err?.message === "Forbidden" ? 403 :
          err?.message === "Set not found" ? 404 : 400;
      return res.status(status).json({ error: err.message ?? "Update failed" });
    }
  }

  // POST /sets/:setId/queue
  // Body: { trackIds?: string[], playNow?: boolean, deviceId?: string, name?: string }
  // If trackIds is not provided, caller is expected to pass the setId and the frontend
  // can send the set's songs. This endpoint creates a temporary private playlist,
  // adds tracks (preserving order), starts playback (if requested) and stores the
  // temp playlist id in Redis so it can be removed next time the user queues another set.
  @httpPost("/spotify/queue", AuthMiddleware)
  async queueSet(req: Request, res: Response) {

    try {
      const { setId } = req.params;
      const body = req.body || {};
      // prefer explicit trackIds from body; require at least one id
      const rawTrackIds: string[] = Array.isArray(body.trackIds)
        ? body.trackIds
        : [];

      if (!rawTrackIds.length) {
        return res.status(400).json({ error: "Missing trackIds (send set songs from frontend)" });
      }

      const playNow = !!body.playNow || !!body.playFirst;
      const deviceId = body.deviceId as string | undefined;
      const nameHint = (body.name as string | undefined) || `Temp Set ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

      const appUserId = req.user!.id;
      const accessToken = await this.spotify.ensureAccessToken(appUserId);

      const chunk = <T,>(arr: T[], size: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      // delete previous temp playlist if present (best-effort)
      try {
        const prev = await redisClient.get(`${TEMP_PLAYLIST_PREFIX}${appUserId}`);
        if (prev) {
          try {
            await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(prev)}/followers`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
          } catch (e) {
            console.warn("Failed to delete previous temp playlist", prev, e);
          }
          await redisClient.del(`${TEMP_PLAYLIST_PREFIX}${appUserId}`);
        }
      } catch (e) {
        console.warn("Redis check/delete for previous temp playlist failed", e);
      }

      // get spotify user id to create playlist
      let spotifyUserId: string;
      try {
        const me = await this.spotify.getCurrentUserProfile(accessToken);
        spotifyUserId = me.id;
      } catch (e: any) {
        console.error("Failed to fetch spotify profile", e);
        return res.status(502).json({ error: "Failed to fetch Spotify profile" });
      }

      // create private playlist
      let playlistId: string;
      try {
        const createResp = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(spotifyUserId)}/playlists`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: nameHint,
            description: "Temporary playlist created by Gooodvibez",
            public: false,
          }),
        });
        if (!createResp.ok) {
          const txt = await createResp.text().catch(() => "");
          console.error("Create playlist failed", createResp.status, txt);
          return res.status(createResp.status).json({ error: "Create playlist failed", details: txt });
        }
        const created = await createResp.json();
        playlistId = created.id;
      } catch (e: any) {
        console.error("Create playlist error", e);
        return res.status(500).json({ error: "Failed to create playlist" });
      }

      // add tracks in chunks
      try {
        const uris = rawTrackIds.map((id) => `spotify:track:${id}`);
        const groups = chunk(uris, 100);
        for (const g of groups) {
          const addResp = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: g }),
          });
          if (!addResp.ok) {
            const txt = await addResp.text().catch(() => "");
            console.error("Add tracks failed", addResp.status, txt);
            try { await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/followers`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }); } catch { }
            return res.status(addResp.status).json({ error: "Add tracks failed", details: txt });
          }
        }
      } catch (e: any) {
        console.error("Add tracks error", e);
        try { await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/followers`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }); } catch { }
        return res.status(500).json({ error: "Failed to add tracks to playlist" });
      }

      // persist playlist id in redis
      try {
        await redisClient.set(`${TEMP_PLAYLIST_PREFIX}${appUserId}`, playlistId, { EX: TEMP_PLAYLIST_TTL });
      } catch (e) {
        console.warn("Failed to persist temp playlist id in redis", e);
      }

      // ensure shuffle off (best-effort)
      try {
        await fetch(`https://api.spotify.com/v1/me/player/shuffle?state=false${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (e) {
        // ignore
      }

      // start playback of the playlist if requested (replace playback) - reuse SpotifyService
      if (playNow) {
        try {
          await this.spotify.playUrisForUser(appUserId, [`spotify:playlist:${playlistId}`], deviceId);
        } catch (e: any) {
          console.error("Play playlist error", e);
          const status = e?.status ?? 500;
          return res.status(status).json({ error: "Failed to start playback", details: e?.details ?? e?.message, playlistId });
        }
      }

      return res.json({ ok: true, playlistId, total: rawTrackIds.length, deviceId: deviceId ?? null });
    } catch (err: any) {
      console.error("queueSet (playlist) error", err);
      return res.status(500).json({ error: err?.message ?? "Internal Server Error" });
    }
  }

}