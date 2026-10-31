/**
 * Private HTTP API of the processor. Every route except /healthz requires an
 * HMAC signature from the public API (see packages/shared/src/signing.ts).
 * Work is queued and the request returns 202 right away; callers poll the DB.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@print/shared";
import { buildJob, cleanup, processFile, type Deps } from "./jobs.js";
import type { WorkQueue } from "./queue.js";

const FileBody = z.object({ fileId: z.uuid() });
const JobBody = z.object({ jobId: z.uuid() });

export interface ServerOptions {
  secret: string;
  logLevel: string;
  makeDeps: (log: Deps["log"]) => Deps;
  queue: WorkQueue;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: opts.logLevel },
    bodyLimit: 64 * 1024,
  });

  // Keep the raw body so the signature is checked over the exact bytes sent.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, json: body === "" ? {} : JSON.parse(body as string) });
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.routeOptions.url === "/healthz") return;
    const body = req.body as { raw?: string } | undefined;
    const ok = await verifySignature(
      opts.secret,
      body?.raw ?? "",
      req.headers[TIMESTAMP_HEADER] as string | undefined,
      req.headers[SIGNATURE_HEADER] as string | undefined,
    );
    if (!ok) return reply.code(401).send({ error: "bad signature" });
  });

  const parse = <T>(schema: z.ZodType<T>, body: unknown): T | null => {
    const r = schema.safeParse((body as { json?: unknown } | undefined)?.json);
    return r.success ? r.data : null;
  };

  app.get("/healthz", async () => ({ ok: true, queued: opts.queue.size }));

  app.post("/process-file", async (req, reply) => {
    const body = parse(FileBody, req.body);
    if (!body) return reply.code(400).send({ error: "fileId required" });
    const deps = opts.makeDeps(req.log);
    opts.queue.push(`file:${body.fileId}`, () => processFile(deps, body.fileId));
    return reply.code(202).send({ queued: true });
  });

  app.post("/build-job", async (req, reply) => {
    const body = parse(JobBody, req.body);
    if (!body) return reply.code(400).send({ error: "jobId required" });
    const deps = opts.makeDeps(req.log);
    opts.queue.push(`job:${body.jobId}`, () => buildJob(deps, body.jobId));
    return reply.code(202).send({ queued: true });
  });

  /** For an external scheduler (e.g. Cloud Scheduler) when the built-in timer is off. */
  app.post("/cleanup", async (req) => cleanup(opts.makeDeps(req.log)));

  return app;
}
