import "reflect-metadata";
import { injectable, inject } from "inversify";
import SetRepository from "../repos/Set.repository";
import UserRepository from "../repos/User.repository";
import SpotifyService from "./Spotify.service";
import TrackServiceCache from './TrackCache.service';

//// SCHEMAS AND INTERFACES
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

  async createSet(creatorId: string, dto: ICreateSetInput) {

    const songs = Array.from(new Set((dto.songs ?? [])));
    const collaborators = (dto.collaborators ?? []).filter(Boolean);

    const set = await this.set.create({
      name: dto.name,
      description: dto.description,
      songs,
      tags: dto.tags,
      collaborators,
      createdBy: creatorId,
    });

    await this.user.pushSet(creatorId, set._id as any);
    return set;

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

    const current: string[] = set.songs ?? [];

    // 1) dedupe incoming & skip ones already present (preserve order of incoming)
    const incoming = Array.from(new Set(trackIds)).filter(id => !current.includes(id));

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
    const next = current.concat(validIds);
    await this.set.setSongs(setId, next);

    return { songs: next, added: validIds.length, addedTracks: hydrated, skipped };

  }

  // src/services/Set.service.ts (add)
  async replaceSongs(setId: string, userId: string, finalOrder: string[]) {
    await this.assertCanEdit(setId, userId);

    const set = await this.set.findById(setId);
    if (!set) throw new Error("Set not found");

    const current = set.songs ?? [];

    // Only allow reordering/removal here (no additions via this endpoint).
    // Drop any IDs that aren’t in current; de-dupe while preserving order.
    const currentSet = new Set(current);
    const next: string[] = [];
    for (const id of finalOrder) {
      if (currentSet.has(id) && !next.includes(id)) next.push(id);
    }

    console.log("current", current, "finalOrder", finalOrder, "next", next);
    // (Optional strict mode)
    // If finalOrder contains any id not in current, treat as error:
    // const unknown = finalOrder.filter(id => !currentSet.has(id));
    // if (unknown.length) throw new Error(`Unknown ids in final order: ${unknown.join(",")}`);

    const removed = current.filter(id => !next.includes(id));
    const orderChanged = JSON.stringify(current) !== JSON.stringify(next);

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