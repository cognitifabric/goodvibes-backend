// src/schemas/set.songs.schema.ts
import { z } from "zod";

export const ReplaceSongsSchema = z.object({
  songs: z.array(z.string()).optional().default([]), // final order after user edits
});
export interface IReplaceSongsInput extends z.infer<typeof ReplaceSongsSchema> { }
