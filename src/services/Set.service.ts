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

  async createSet(userId: string, input: ICreateSetInput) {
    // build document payload explicitly so images/tags/songs are persisted
    const toSave = {
      name: input.name,
      description: input.description ?? undefined,
      // now persisting full song objects (id, title, artists, image)
      songs: input.songs ?? [],
      tags: input.tags ?? [],
      collaborators: input.collaborators ?? [],
      images: input.images ?? [],
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
    const toAdd: SetSong[] = hydrated.map((h: any) => ({
      id: h.trackId,
      title: h.title ?? h.name ?? h.trackName ?? "",
      artists: Array.isArray(h.artists) ? h.artists.join(", ") : (h.artists ?? (h.artistName ?? "")),
      image:
        h.image ??
        h.albumImage ??
        (h.album && Array.isArray(h.album.images) && h.album.images[0] ? h.album.images[0].url : undefined),
    })).filter(s => !!s.id);

    const next: SetSong[] = current.concat(toAdd);
    await this.set.setSongs(setId, next);

    return { songs: next, added: toAdd.length, addedTracks: hydrated, skipped };
  }

  // src/services/Set.service.ts (add)
  async replaceSongs(setId: string, userId: string, finalOrder: string[]) {
    await this.assertCanEdit(setId, userId);

    const set = await this.set.findById(setId);
    if (!set) throw new Error("Set not found");

    const current: SetSong[] = (set.songs ?? []) as SetSong[];
    const currentIds = current.map(s => s.id);

    // Only allow reordering/removal here (no additions via this endpoint).
    // Drop any IDs that aren’t in current; de-dupe while preserving order.
    const nextIds: string[] = [];
    for (const id of finalOrder) {
      if (currentIds.includes(id) && !nextIds.includes(id)) nextIds.push(id);
    }

    // Map ids back to song objects preserving metadata
    const idToSong = new Map(current.map(s => [s.id, s]));
    const next: SetSong[] = nextIds.map(id => idToSong.get(id)!).filter(Boolean);

    console.log("currentIds", currentIds, "finalOrder", finalOrder, "nextIds", nextIds);

    // (Optional strict mode)
    // If finalOrder contains any id not in current, treat as error:
    // const unknown = finalOrder.filter(id => !currentSet.has(id));
    // if (unknown.length) throw new Error(`Unknown ids in final order: ${unknown.join(",")}`);

    const removed = current.filter(s => !nextIds.includes(s.id));
    const orderChanged = JSON.stringify(currentIds) !== JSON.stringify(nextIds);

    await this.set.setSongs(setId, next);

    return {
      songs: next,
      removedCount: removed.length,
      removed,
      orderChanged,
      length: next.length,
    };

  }

  async updateSetBasic(setId: string, userId: string, patch: { name?: string; description?: string | null; tags?: string[] }) {
    await this.assertCanEdit(setId, userId);

    const exists = await this.set.findById(setId);
    if (!exists) throw new Error("Set not found");

    const updated = await this.set.updateBasic(setId, patch);
    if (!updated) throw new Error("Set not found");

    // If you cache hydrated set views in Redis, bust here:
    // await this.cache.del(`set:view:${setId}`);

    return updated;

  }


}