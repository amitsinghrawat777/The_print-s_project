import "server-only";
import { sha256Hex } from "@print/shared";
import { db } from "./db";
import { env } from "./env";
import { HttpError, clientIp } from "./http";

/**
 * Fixed-window rate limit backed by Postgres (`hit_rate_limit`). Client IPs are
 * hashed with a salt before storage. Fails open if the DB call errors, so a
 * rate-limit hiccup never blocks a customer at the counter.
 */
export async function rateLimit(
  scope: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const key = `${scope}:${await sha256Hex(`${env().RATE_LIMIT_SALT}:${subject}`)}`;
  const { data, error } = await db().rpc("hit_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) {
    console.warn("[rate-limit] check failed, allowing", error.message);
    return;
  }
  if (data === false) {
    throw new HttpError(429, "Too many requests. Please wait a minute and try again.", "RATE_LIMIT");
  }
}

export function rateLimitByIp(req: Request, scope: string, max: number, windowSeconds: number) {
  return rateLimit(scope, clientIp(req), max, windowSeconds);
}
