import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { ApiErrorCode } from '@prints/shared';
import { db } from './db';
import { env } from './env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Wraps a route handler so thrown ApiErrors become JSON error responses. */
export function route<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { error: { code: error.code, message: error.message, details: error.details } },
          { status: error.status },
        );
      }
      console.error(error);
      return Response.json(
        { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } },
        { status: 500 },
      );
    }
  };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, 'BAD_REQUEST', first?.message ?? 'Invalid request', parsed.error.issues);
  }
  return parsed.data;
}

/** A random secret the customer's browser keeps for its job. Only its hash is stored. */
export function newAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const JOB_TOKEN_HEADER = 'x-job-token';

export interface JobRow {
  id: string;
  shop_id: string;
  status: string;
  token: string | null;
  customer_name: string | null;
  note: string | null;
  subtotal_paise: number | null;
  rounding_paise: number | null;
  total_paise: number | null;
  created_at: string;
  submitted_at: string | null;
  access_token_hash: string;
}

/** Loads a job and checks the caller holds its access token. */
export async function requireJob(req: Request, jobId: string): Promise<JobRow> {
  const token = req.headers.get(JOB_TOKEN_HEADER);
  if (!token || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Order not found');
  }
  const { data, error } = await db()
    .from('jobs')
    .select(
      'id, shop_id, status, token, customer_name, note, subtotal_paise, rounding_paise, total_paise, created_at, submitted_at, access_token_hash',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;

  // same response for "no such job" and "wrong token" so job ids can't be probed
  const expected = data ? Buffer.from(data.access_token_hash, 'hex') : Buffer.alloc(32);
  const actual = Buffer.from(hashToken(token), 'hex');
  if (!data || !timingSafeEqual(expected, actual)) {
    throw new ApiError(404, 'NOT_FOUND', 'Order not found');
  }
  return data as JobRow;
}

export function requireDraft(job: JobRow) {
  if (job.status !== 'draft') {
    throw new ApiError(409, 'NOT_EDITABLE', 'This order has already been sent');
  }
}

/** A keyed hash of the caller's IP, only used for rate limiting. */
export function clientIpHash(req: Request): string | null {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
  if (!ip) return null;
  return createHmac('sha256', env().PROCESSOR_SECRET).update(`ip:${ip}`).digest('hex');
}
