import 'server-only';
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  PROCESSOR_URL: z.url(),
  PROCESSOR_SECRET: z.string().min(16),
});

let cached: z.infer<typeof schema> | undefined;

/** Server-only settings, validated on first use. */
export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid web server environment (${problems}). See apps/web/.env.example`);
    }
    cached = parsed.data;
  }
  return cached;
}
