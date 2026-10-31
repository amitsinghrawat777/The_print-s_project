/**
 * HMAC-SHA256 request signing between the public API and the private processor.
 * Uses Web Crypto so it runs in Node 22+, edge runtimes and browsers alike.
 *
 *   signature = hex(HMAC(secret, `${timestamp}.${body}`))
 *   headers:   x-print-timestamp: <unix seconds>, x-print-signature: <hex>
 */
export const SIGNATURE_HEADER = "x-print-signature";
export const TIMESTAMP_HEADER = "x-print-timestamp";
export const SIGNATURE_MAX_AGE_SECONDS = 300;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signBody(
  secret: string,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const timestamp = String(nowSeconds);
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: await hmacHex(secret, `${timestamp}.${body}`),
  };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(
  secret: string,
  body: string,
  timestamp: string | undefined,
  signature: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return timingSafeEqualHex(expected, signature.toLowerCase());
}

/** sha256 hex of a string, e.g. for storing customer job secrets. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
