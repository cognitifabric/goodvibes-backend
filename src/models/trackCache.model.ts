import { Schema, model, models } from "mongoose";

export interface TrackCacheDoc {
  trackId: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { id: string; name: string; image?: string };
  duration_ms: number;
  uri: string;
  external_url?: string;
  explicit?: boolean;
  popularity?: number;
  updatedAt: Date;
}

const TrackCacheSchema = new Schema<TrackCacheDoc>(
  {
    trackId: { type: String, unique: true, index: true, required: true },
    name: String,
    artists: [{ id: String, name: String }],
    album: { id: String, name: String, image: String },
    duration_ms: Number,
    uri: String,
    external_url: String,
    explicit: Boolean,
    popularity: Number,
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

const TrackCache = models.TrackCache || model<TrackCacheDoc>("TrackCache", TrackCacheSchema);

export default TrackCache