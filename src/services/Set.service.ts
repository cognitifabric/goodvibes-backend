import "reflect-metadata";
import { injectable, inject } from "inversify";
import SetRepository from "../repos/Set.repository";
import UserRepository from "../repos/User.repository";
import SpotifyService from "./Spotify.service";
import TrackServiceCache from './TrackCache.service';
import { Set as SetModel } from "../models/set.model";
import type { SetSong } from "../models/set.model";
import { ICreateSetInput } from "../interfaces/set.interface";

function looksLikeSpotifyId(id: string) {
  return /^[A-Za-z0-9]{22}$/.test(id); // Spotify track id format
}

function normalize(v: string) { return v.startsWith("spotify:track:") ? v.split(":").pop()! : v; }
function isTrackId(v: string) { return /^[A-Za-z0-9]{22}$/.test(normalize(v)); }

@injectable()
export default class SetService {
  constructor(private set: SetRepository, private user: UserRepository, private spotify: SpotifyService, private cache: TrackServiceCache
  ) { }

  // pick first up to 5 non-empty images from a songs array
  private static imagesFromSongs(songs: SetSong[] | undefined): string[] {
    if (!Array.isArray(songs) || songs.length === 0) return [];
    return songs.map(s => (s as any)?.image).filter(Boolean).slice(0, 5);
  }

  async createSet(userId: string, input: ICreateSetInput) {
    // build document payload explicitly so images/tags/songs are persisted
    const toSave = {
      name: input.name,
      description: input.description ?? undefined,
      // now persisting full song objects (id, title, artists, image)
      songs: input.songs ?? [],
      tags: input.tags ?? [],
      collaborators: input.collaborators ?? [],
      // prefer provided images, otherwise derive from provided songs
      images: (input.images && input.images.length ? input.images : (SetService.imagesFromSongs(input.songs ?? []))),
      createdBy: userId,
    };

    const doc = new SetModel(toSave);
    await doc.save();

    // ensure the user's `sets` array includes this new set
    try {
      await this.user.pushSet(userId, doc._id.toString());
    } catch (err) {
      // log but don't fail creation — consider rolling back if you need strict consistency
      console.warn("Failed to push set id to user.sets:", err);
    }

    return doc.toObject();
  }

  private async assertCanEdit(setId: string, userId: string) {
    const ok = await this.set.isEditor(setId, userId);
    if (!ok) throw new Error("Forbidden");
  }

  async addSongs(setId: string, userId: string, trackIds: string[]) {
    await this.assertCanEdit(setId, userId);

    const set = await this.set.findById(setId);
    if (!set) throw new Error("Set not found");

    console.log("Set before adding songs", set);

    // current is an array of song objects
    const current: SetSong[] = (set.songs ?? []) as SetSong[];
    const currentIds = current.map(s => s.id);

    // 1) dedupe incoming & skip ones already present (preserve order of incoming)
    const incoming = Array.from(new Set(trackIds)).filter(id => !currentIds.includes(id));

    if (incoming.length === 0) {
      return { songs: current, added: 0, addedTracks: [], skipped: [] };
    }

    // 2) hydrate via Spotify -> only IDs that *really* exist will come back
    const accessToken = await this.spotify.ensureAccessToken(userId);
    const hydrated = await this.cache.getManyWithHydrate(accessToken, incoming); // TrackCacheDoc[]
    const validIds = hydrated.map(t => t.trackId);

    // 3) anything not returned is invalid / not found -> skip it
    const skipped = incoming.filter(id => !validIds.includes(id));

    // 4) append only valid new IDs, preserve order
    // Convert hydrated items to SetSong objects (be defensive about property names)
    const toAdd: SetSong[] = hydrated
      .map((h: any) => {
        // defensive normalization for various TrackCacheDoc shapes
        const trackId = h?.trackId ?? h?.id ?? undefined;
        const title = h?.title ?? h?.name ?? h?.trackName ?? "";
        // Preserve the artists value as provided by the cache/backend (do not coerce)
        const artists = h?.artists ?? h?.artistName ?? undefined;
        const image =
          h?.image ??
          h?.albumImage ??
          (h?.album && Array.isArray(h.album.images) && h.album.images[0] ? h.album.images[0].url : undefined);

        if (!trackId) return null;
        return { id: trackId, title, artists, image } as SetSong;
      })
      .filter((s): s is SetSong => !!s);

    const next: SetSong[] = current.concat(toAdd);
    // persist songs and update images to reflect newest first-5 images
    await this.set.setSongs(setId, next);
    try {
      const imgs = SetService.imagesFromSongs(next);
      if (imgs.length) {
        await SetModel.findByIdAndUpdate(setId, { images: imgs }).exec();
      }
    } catch (e) {
      console.warn("Failed to update set images after addSongs", e);
    }

    return { songs: next, added: toAdd.length, addedTracks: hydrated, skipped };
  }

  // src/services/Set.service.ts (replaceSongs)
  async replaceSongs(setId: string, userId: string, finalOrder: string[]) {
    await this.assertCanEdit(setId, userId);

    const set = await this.set.findById(setId);
    if (!set) throw new Error("Set not found");

    const current: SetSong[] = (set.songs ?? []) as SetSong[];
    const currentIds = current.map(s => s.id);

    // Build map of existing song objects
    const idToSong = new Map(current.map(s => [s.id, s]));

    // Determine which ids in finalOrder are new (not in current)
    const toHydrateIds: string[] = [];
    const seen = new Set<string>();
    for (const id of finalOrder) {
      const nid = normalize(id);
      if (!seen.has(nid)) {
        seen.add(nid);
        if (!currentIds.includes(nid)) toHydrateIds.push(nid);
      }
    }

    // Hydrate any new ids via TrackCache/Spotify
    let hydratedMap = new Map<string, any>();
    if (toHydrateIds.length > 0) {
      const accessToken = await this.spotify.ensureAccessToken(userId);
      try {
        const hydrated = await this.cache.getManyWithHydrate(accessToken, toHydrateIds); // TrackCacheDoc[]
        for (const h of hydrated) {
          if (!h) continue;
          const trackId = (h as any).trackId ?? (h as any).id;
          if (!trackId) continue;
          const title = (h as any).title ?? (h as any).name ?? (h as any).trackName ?? "";
          // Preserve artists value as-is (string, array or object) — don't coerce
          const artists = (h as any).artists ?? (h as any).artistName ?? undefined;
          const image =
            (h as any).image ??
            (h as any).albumImage ??
            ((h as any).album && Array.isArray((h as any).album.images) && (h as any).album.images[0]
              ? (h as any).album.images[0].url
              : undefined);

          const songObj: SetSong = { id: trackId, title, artists, image };
          hydratedMap.set(trackId, songObj);
        }
      } catch (err) {
        console.warn("replaceSongs: hydration failed for new ids", toHydrateIds, err);
        // proceed — missing hydrated items will be skipped below
      }
    }

    // Build next array of SetSong objects in the requested order, skipping unknown ids
    const next: SetSong[] = [];
    const nextIds: string[] = [];
    for (const rawId of finalOrder) {
      const id = normalize(rawId);
      if (nextIds.includes(id)) continue; // dedupe
      let song = idToSong.get(id);
      if (!song && hydratedMap.has(id)) song = hydratedMap.get(id);
      if (song) {
        next.push(song);
        nextIds.push(id);
      } else {
        // Unknown id (neither in current nor hydrated) -> skip (or optionally throw)
        console.warn("replaceSongs: unknown track id skipped", id);
      }
    }

    const removed = current.filter(s => !nextIds.includes(s.id));
    const orderChanged = JSON.stringify(current.map(s => s.id)) !== JSON.stringify(nextIds);

    // persist full song objects
    await this.set.setSongs(setId, next);
    // update images to reflect new song order (first up-to-5 images)
    try {
      const imgs = SetService.imagesFromSongs(next);
      await SetModel.findByIdAndUpdate(setId, { images: imgs }).exec();
    } catch (e) {
      console.warn("replaceSongs: failed to update images", e);
    }

    return {
      songs: next,
      removedCount: removed.length,
      removed,
      orderChanged,
      length: next.length,
    };
  }

  async updateSetBasic(setId: string, userId: string, patch: { name?: string; description?: string | null; tags?: string[]; images?: string[] }) {
    await this.assertCanEdit(setId, userId);

    const exists = await this.set.findById(setId);
    if (!exists) throw new Error("Set not found");

    // update basic fields via repository
    const updated = await this.set.updateBasic(setId, {
      name: patch.name,
      description: patch.description ?? null,
      tags: patch.tags ?? [],
    });
    if (!updated) throw new Error("Set not found");

    // if images provided, persist them as well
    if (Array.isArray(patch.images)) {
      try {
        await SetModel.findByIdAndUpdate(setId, { images: patch.images }).exec();
      } catch (e) {
        console.warn("updateSetBasic: failed to persist images", e);
      }
    }

    // If you cache hydrated set views in Redis, bust here:
    // await this.cache.del(`set:view:${setId}`);

    return updated;
  }

}