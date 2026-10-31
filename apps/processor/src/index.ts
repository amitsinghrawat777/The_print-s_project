import { loadEnv } from './env';
import { buildServer } from './server';
import { createWorker } from './work';

const env = loadEnv();

// The worker logs through Fastify's logger once the server exists.
let app: ReturnType<typeof buildServer>;
const worker = createWorker(env, {
  info: (obj, msg) => app.log.info(obj, msg),
  error: (obj, msg) => app.log.error(obj, msg),
});
app = buildServer(worker, env.PROCESSOR_SECRET);

if (env.MAINTENANCE_INTERVAL_MS > 0) {
  let running = false;
  let ticks = 0;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await worker.retryStuckWork();
      // delete old files every 15 ticks (15 minutes by default)
      if (ticks++ % 15 === 0) await worker.purgeOldJobs();
    } catch (err) {
      app.log.error({ err }, 'maintenance failed');
    } finally {
      running = false;
    }
  }, env.MAINTENANCE_INTERVAL_MS).unref();
}

await app.listen({ port: env.PORT, host: env.HOST });
