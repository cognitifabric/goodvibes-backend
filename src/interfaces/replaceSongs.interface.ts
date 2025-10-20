// src/schemas/set.songs.schema.ts
import { z } from "zod";
import { SongObject } from "./set.interface";

export const ReplaceSongsSchema = z.object({
  // allow either an array of song ids (string) or full SongObject (same shape as create)
  songs: z.array(z.union([z.string().min(1), SongObject])).optional().default([]),
});

export type IReplaceSongsInput = z.infer<typeof ReplaceSongsSchema>;
