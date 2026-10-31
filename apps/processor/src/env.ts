import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  PROCESSOR_SECRET: z.string().min(16),
  GOTENBERG_URL: z.url(),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** How often to retry stuck work and delete old files. 0 turns it off. */
  MAINTENANCE_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid processor environment:\n${problems}`);
  }
  return parsed.data;
}
