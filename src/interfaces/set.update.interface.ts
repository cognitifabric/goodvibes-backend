// src/schemas/set.update.schema.ts
import { z } from "zod";

export const UpdateSetSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  // send full new tag list (replace); allow empty array if you want to clear
  tags: z.array(z.string().min(1)).optional(),
})
  .refine(obj => Object.keys(obj).length > 0, { message: "No fields to update" });

export interface IUpdateSetInput extends z.infer<typeof UpdateSetSchema> { }
