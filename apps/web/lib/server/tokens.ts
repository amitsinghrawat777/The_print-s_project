import "server-only";
import { sha256Hex } from "@print/shared";

/** 256-bit random secret (base64url) and its sha256 hex for storage. */
export async function newAccessToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Buffer.from(bytes).toString("base64url");
  return { token, hash: await sha256Hex(token) };
}
