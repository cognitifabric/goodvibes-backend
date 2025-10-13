import { z } from "zod";

export const SignupSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email(),
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
  password: z.string().min(8).max(128).refine((val) => /[A-Z]/.test(val), { message: "Must include at least one uppercase letter" }).refine((val) => /[a-z]/.test(val), { message: "Must include at least one lowercase letter" }).refine((val) => /[0-9]/.test(val), { message: "Must include at least one number" }),
  rememberMe: z.boolean().optional().default(false),
  acceptedTermsAt: z.coerce.date().default(() => new Date()), // if omitted, set now
  marketingOptIn: z.boolean().optional().default(false),
  timezone: z.string().default("UTC")
});

// Export an interface from the schema
export interface SignupInput extends z.infer<typeof SignupSchema> { }
