// src/schemas/set.schema.ts
import { z } from "zod";

export const SongObject = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artists: z.string().optional(),
  image: z.string().url().optional(),
});

export const CreateSetSchema = z.object({
  name: z.string().min(1).max(120),
  // description may be omitted or null from client
  description: z.string().max(500).nullable().optional(),
  // Require at least one song on create (now objects)
  songs: z.array(SongObject).min(1, "At least one song is required"),
  // tags are optional; default to empty array if omitted
  tags: z.array(z.string().min(1)).optional().default([]),
  // IDs of users (ObjectId strings) who can collaborate
  collaborators: z.array(z.string()).optional().default([]),
  // images optional; if provided limit to max 5 valid URLs
  images: z.array(z.string().url()).optional().default([]),
  // NOTE: suggestions, lovedBy, lastCollaboration are NOT client-provided on create.
  // They will be initialized by the server/model as empty/undefined.
  createdBy: z.string().min(1)
});

export type SongInput = z.infer<typeof SongObject>;
export type CreateSetInput = z.infer<typeof CreateSetSchema>;
export interface ICreateSetInput extends CreateSetInput { }
