import { createClient } from "@supabase/supabase-js";
import { ghostscriptGreyscale } from "./build.js";
import { loadEnv } from "./env.js";
import { cleanup, recoverStuckWork, type Deps } from "./jobs.js";
import { WorkQueue } from "./queue.js";
import { buildServer } from "./server.js";

const env = loadEnv();

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const greyscale = ghostscriptGreyscale(env.GHOSTSCRIPT_BIN);

let app: ReturnType<typeof buildServer>;
const queue = new WorkQueue(env.CONCURRENCY, (key, err) => app.log.error({ err, key }, "task crashed"));
const makeDeps = (log: Deps["log"]): Deps => ({ db, log, gotenbergUrl: env.GOTENBERG_URL, greyscale });

app = buildServer({ secret: env.PROCESSOR_SECRET, logLevel: env.LOG_LEVEL, makeDeps, queue });

const timers: NodeJS.Timeout[] = [];
if (env.SWEEP_INTERVAL_MINUTES > 0) {
  const deps = makeDeps(app.log);
  const safe = (name: string, fn: () => Promise<unknown>) => () => {
    fn().catch((err) => app.log.error({ err }, `${name} failed`));
  };
  timers.push(setInterval(safe("recovery", () => recoverStuckWork(deps, queue)), 60_000));
  timers.push(setInterval(safe("cleanup", () => cleanup(deps)), env.SWEEP_INTERVAL_MINUTES * 60_000));
  setTimeout(safe("startup recovery", () => recoverStuckWork(deps, queue)), 2_000);
}

const shutdown = async () => {
  timers.forEach(clearInterval);
  await app.close();
  await Promise.race([queue.onIdle(), new Promise((r) => setTimeout(r, 20_000))]);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
