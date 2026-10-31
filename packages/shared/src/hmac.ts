/**
 * Signs requests from the API to the private processor service.
 * Uses Web Crypto so it runs in Node and edge runtimes alike.
 *
 * Signature = hex(HMAC-SHA256(secret, `${timestamp}.${body}`)), sent as the
 * `x-signature` header with the Unix-seconds timestamp in `x-timestamp`.
 */
export const SIGNATURE_HEADER = 'x-signature';
export const TIMESTAMP_HEADER = 'x-timestamp';

const encoder = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function signBody(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await hmacKey(secret);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)));
}

export async function signedHeaders(secret: string, body: string): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: await signBody(secret, timestamp, body),
  };
}

export async function verifyBody(
  secret: string,
  timestamp: string | undefined,
  body: string,
  signature: string | undefined,
  maxAgeSeconds = 300,
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > maxAgeSeconds) return false;
  const sig = fromHex(signature);
  if (!sig) return false;
  const key = await hmacKey(secret);
  return crypto.subtle.verify('HMAC', key, sig, encoder.encode(`${timestamp}.${body}`));
}
