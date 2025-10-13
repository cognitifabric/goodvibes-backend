// src/schemas/spotify.ts
import { z } from "zod";

export const SpotifySearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: z.number().int().min(1).max(50).optional().default(10),
  market: z.string().optional(), // e.g., "US" or "from_token"
});

// derived TS type
export type SpotifySearchInput = z.infer<typeof SpotifySearchSchema>;

// or export as interface if you prefer the `interface` keyword
export interface ISpotifySearchInput extends SpotifySearchInput { }
