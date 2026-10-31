import Fastify, { type FastifyInstance } from 'fastify';
import {
  buildJobBody,
  processFileBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyBody,
} from '@prints/shared';
import type { Worker } from './work';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/**
 * Private HTTP API, called only by the web API (HMAC-signed). Work runs in the
 * background after a 202 so callers on serverless platforms aren't held open.
 */
export function buildServer(worker: Worker, secret: string, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 64 * 1024 });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      (error as { statusCode?: number }).statusCode = 400;
      done(error as Error, undefined);
    }
  });

  app.get('/health', async () => ({ ok: true }));

  app.register(async (signed) => {
    signed.addHook('preHandler', async (req, reply) => {
      const ok = await verifyBody(
        secret,
        req.headers[TIMESTAMP_HEADER] as string | undefined,
        req.rawBody ?? '',
        req.headers[SIGNATURE_HEADER] as string | undefined,
      );
      if (!ok) return reply.code(401).send({ error: 'bad signature' });
    });

    const runInBackground = (name: string, task: () => Promise<unknown>) => {
      task().catch((err) => app.log.error({ err }, `${name} failed`));
    };

    signed.post('/process-file', async (req, reply) => {
      const body = processFileBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad request' });
      runInBackground('process-file', () => worker.processFile(body.data.fileId));
      return reply.code(202).send({ accepted: true });
    });

    signed.post('/build-job', async (req, reply) => {
      const body = buildJobBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad request' });
      runInBackground('build-job', () => worker.buildJob(body.data.jobId));
      return reply.code(202).send({ accepted: true });
    });

    signed.post('/cleanup', async () => ({ purged: await worker.purgeOldJobs() }));
  });

  return app;
}
