import "server-only";
import { z } from "zod";

const Env = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PROCESSOR_URL: z.url(),
  PROCESSOR_SECRET: z.string().min(16),
  RATE_LIMIT_SALT: z.string().min(8),
});

let cached: z.infer<typeof Env> | undefined;

export function env() {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid web environment (see apps/web/.env.example): ${issues.join("; ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}
