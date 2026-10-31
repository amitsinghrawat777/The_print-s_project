import "server-only";
import type { z } from "zod";
import type { ApiError } from "@print/shared";

/** An error that becomes a JSON response with a customer-friendly message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Wraps a route handler: maps HttpError / unknown errors to JSON responses. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        const body: ApiError & Record<string, unknown> = {
          error: err.message,
          ...(err.code ? { code: err.code } : {}),
          ...err.extra,
        };
        return json(body, err.status);
      }
      console.error("[api] unexpected error", err);
      return json<ApiError>({ error: "Something went wrong. Please try again." }, 500);
    }
  };
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid request body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, first?.message ?? "Invalid request", "VALIDATION");
  }
  return parsed.data;
}

/** Maps our Postgres function errors (SQLSTATE PRxxx) to HTTP errors. */
export function fromDbError(error: { code?: string; message: string }): HttpError {
  const code = error.message.split(":")[0]?.trim();
  switch (error.code) {
    case "PR404":
      return new HttpError(404, code === "SHOP_NOT_FOUND" ? "Shop not found" : "Not found", code);
    case "PR409":
      return new HttpError(
        409,
        code === "SHOP_PAUSED"
          ? "This shop isn't taking orders right now. Please ask at the counter."
          : "This order was already sent.",
        code,
      );
    case "PR422":
      return new HttpError(422, "Some files changed. Please refresh and try again.", code);
    default:
      console.error("[db] unexpected error", error);
      return new HttpError(500, "Something went wrong. Please try again.", "DB");
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
