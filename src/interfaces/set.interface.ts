// src/schemas/set.schema.ts
import { z } from "zod";

export const CreateSetSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  // Accept plain strings; allow empty on create
  songs: z.array(z.string()).optional().default([]),
  // Require at least one tag
  tags: z.array(z.string().min(1)).min(1, "At least one tag is required"),
  // IDs of users (ObjectId strings) who can collaborate
  collaborators: z.array(z.string()).optional().default([]),
  // NOTE: suggestions, lovedBy, lastCollaboration are NOT client-provided on create.
  // They will be initialized by the server/model as empty/undefined.
  createdBy: z.string().min(1)
});

export type CreateSetInput = z.infer<typeof CreateSetSchema>;
export interface ICreateSetInput extends CreateSetInput { }
