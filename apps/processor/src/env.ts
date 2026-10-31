import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** Shared secret with the web API for HMAC-signed requests. */
  PROCESSOR_SECRET: z.string().min(16),
  /** Gotenberg base URL, e.g. http://localhost:3001 */
  GOTENBERG_URL: z.url(),
  /** Ghostscript binary, used to make greyscale copies for single-pass mixed jobs. */
  GHOSTSCRIPT_BIN: z.string().default("gs"),
  CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Minutes between cleanup + recovery sweeps; 0 disables the timer. */
  SWEEP_INTERVAL_MINUTES: z.coerce.number().min(0).default(15),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid processor environment:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
