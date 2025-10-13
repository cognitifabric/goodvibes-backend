// src/schemas/login.schema.ts
import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(true), // keep user signed in by default
});

export type LoginInput = z.infer<typeof LoginSchema>;
