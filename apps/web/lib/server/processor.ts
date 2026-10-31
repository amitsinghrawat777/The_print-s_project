import 'server-only';
import { signedHeaders } from '@prints/shared';
import { env } from './env';

/**
 * Asks the processor to start work. Failures are logged, not thrown: the
 * processor retries anything left waiting, so the customer isn't blocked.
 */
export async function notifyProcessor(path: '/process-file' | '/build-job', body: object): Promise<void> {
  const payload = JSON.stringify(body);
  try {
    const res = await fetch(new URL(path, env().PROCESSOR_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await signedHeaders(env().PROCESSOR_SECRET, payload)) },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`processor ${path} returned ${res.status}`);
  } catch (error) {
    console.error(`processor ${path} unreachable`, error);
  }
}
