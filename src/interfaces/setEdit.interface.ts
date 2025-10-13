// src/schemas/set.edit.schema.ts
import { z } from "zod";

const TrackId = z.string().min(1, "trackId required");

export const AddSongsSchema = z.object({
  songs: z.array(TrackId).min(1, "At least one trackId"),
});
export interface IAddSongsInput extends z.infer<typeof AddSongsSchema> { }

export const RemoveSongSchema = z.object({
  trackId: TrackId,
});
export interface IRemoveSongInput extends z.infer<typeof RemoveSongSchema> { }

export const ReorderSongSchema = z.object({
  fromIndex: z.number().int().min(0),
  toIndex: z.number().int().min(0),
});
export interface IReorderSongInput extends z.infer<typeof ReorderSongSchema> { }

export const AddTagsSchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
});
export interface IAddTagsInput extends z.infer<typeof AddTagsSchema> { }

export const RemoveTagsSchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
});
export interface IRemoveTagsInput extends z.infer<typeof RemoveTagsSchema> { }
