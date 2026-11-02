// Remembers each order's access token on this phone so the status page keeps
// working after a refresh. Storage can be unavailable (private mode), so
// everything falls back to memory.
const memory = new Map<string, string>();
const key = (jobId: string) => `prints:job:${jobId}`;

export function saveJobToken(jobId: string, token: string) {
  memory.set(jobId, token);
  try {
    localStorage.setItem(key(jobId), token);
  } catch {
    // memory only
  }
}

export function readJobToken(jobId: string): string | null {
  try {
    return localStorage.getItem(key(jobId)) ?? memory.get(jobId) ?? null;
  } catch {
    return memory.get(jobId) ?? null;
  }
}
