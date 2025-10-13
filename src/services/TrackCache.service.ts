// services/trackCache.service.ts
import { injectable } from "inversify";
import TrackCache from "../models/trackCache.model";
import axios from "axios";

//// SCHEMAS AND INTERFACES
import { TrackCacheDoc } from "../models/trackCache.model";
import { AxiosError } from "axios";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

type SpotifyTrack = {
  id: string;
  name: string;
  artists?: { id: string; name: string }[];
  album?: { id: string; name: string; images?: { url: string }[] };
  duration_ms: number;
  uri: string;
  external_urls?: { spotify?: string };
  explicit?: boolean;
  popularity?: number;
} | null;

function mapTrack(t: NonNullable<SpotifyTrack>): Omit<TrackCacheDoc, "updatedAt"> {
  return {
    trackId: t.id,
    name: t.name,
    artists: (t.artists ?? []).map(a => ({ id: a.id, name: a.name })),
    album: {
      id: t.album?.id ?? "",
      name: t.album?.name ?? "",
      image: t.album?.images?.[0]?.url,
    },
    duration_ms: t.duration_ms,
    uri: t.uri,
    external_url: t.external_urls?.spotify,
    explicit: t.explicit,
    popularity: t.popularity,
  };
}

// 4XKYLo1eAUFETIt5PLy8ZG
// 6YiIWuVXS4AqF1KvUGMwyx

@injectable()
export default class TrackCacheService {
  async getManyWithHydrate(accessToken: string, ids: string[]) {
    // 1) de-dupe but preserve original order in final mapping
    const unique = Array.from(new Set(ids));

    // 2) read cache and keep only fresh docs
    const cached = await TrackCache.find({ trackId: { $in: unique } }).lean<TrackCacheDoc[]>().exec();
    const fresh = new Map<string, TrackCacheDoc>(cached.filter(c => Date.now() - new Date(c.updatedAt).getTime() < CACHE_TTL_MS).map(c => [c.trackId, c]));

    // 3) which ids are still missing?
    const missing = unique.filter(id => !fresh.has(id));
    if (missing.length === 0) {
      // return in caller’s order
      return ids.map(id => fresh.get(id)).filter(Boolean) as TrackCacheDoc[];
    }

    console.log("cache", cached, "fresh", fresh, "missing", missing)

    // 4) fetch missing in chunks of 50; robust error handling per chunk
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      if (!chunk.length) continue;

      try {
        const { data } = await axios.get<{ tracks: SpotifyTrack[] }>(`${process.env.SPOTIFY_API}/tracks`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { ids: chunk.join(",") },
          // timeout: 8000, // (optional) add a timeout
        });

        console.log("Fetched tracks from Spotify:", data)

        const raw = Array.isArray(data?.tracks) ? data.tracks : [];
        // Spotify returns null for unknown IDs — filter them out
        const docs = raw.filter((t): t is NonNullable<SpotifyTrack> => !!t && !!t.id).map(mapTrack);

        if (docs.length > 0) {
          await TrackCache.bulkWrite(
            docs.map(d => ({
              updateOne: {
                filter: { trackId: d.trackId },
                update: { $set: d },
                upsert: true,
              },
            }))
          );
          // reflect in-memory fresh map
          const now = new Date();
          for (const d of docs) {
            fresh.set(d.trackId, { ...d, updatedAt: now } as TrackCacheDoc);
          }
        }

        // Any IDs that mapped to null just stay missing; we intentionally don’t throw.

      } catch (err) {
        // Log and continue with next chunk; do not break the whole call.
        const ax = err as AxiosError<any>;
        const status = ax.response?.status;
        const msg = ax.response?.data ?? ax.message;
        console.warn(`[TrackCache] hydrate chunk failed (status=${status}):`, msg);
        // Optional: basic backoff on 429
        if (status === 429) {
          const retryAfter = Number(ax.response?.headers?.["retry-after"] ?? 1);
          await new Promise(r => setTimeout(r, Math.min(retryAfter, 5) * 1000));
        }
        // Continue to next chunk regardless
      }
    }

    // 5) return only the items we successfully have (cache or freshly hydrated), preserving order
    return ids.map(id => fresh.get(id)).filter(Boolean) as TrackCacheDoc[];
  }
}