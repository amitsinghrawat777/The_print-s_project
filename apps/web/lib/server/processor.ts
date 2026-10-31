import "server-only";
import { signBody } from "@print/shared";
import { env } from "./env";

/**
 * Fire a signed request at the private processor. Failures are logged, not thrown:
 * the processor's recovery sweep picks up anything that was missed.
 */
export async function notifyProcessor(
  path: "/process-file" | "/build-job",
  payload: Record<string, string>,
): Promise<boolean> {
  const e = env();
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(new URL(path, e.PROCESSOR_URL), {
      method: "POST",
      headers: { "content-type": "application/json", ...(await signBody(e.PROCESSOR_SECRET, body)) },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error(`[processor] ${path} -> ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[processor] ${path} unreachable`, (err as Error).message);
    return false;
  }
}
