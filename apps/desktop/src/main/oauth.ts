import { createServer, type Server } from 'node:http';
import { shell } from 'electron';
import type { OAuthResult } from '../ipc';

/**
 * Google sign-in for a desktop app (RFC 8252): Google refuses to sign in inside
 * embedded windows, so the login runs in the owner's normal browser and comes
 * back to a one-time server on http://127.0.0.1:<random port>/auth/callback.
 * The renderer then trades the `code` for a session (PKCE: the verifier never
 * leaves this computer, so a stolen code is useless).
 */
const TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = '/auth/callback';

interface Pending {
  server: Server;
  redirectTo: string;
  finish: (result: OAuthResult) => void;
  timer?: NodeJS.Timeout;
}
let pending: Pending | null = null;

function page(title: string, text: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f5;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0a0a0a">
<main style="max-width:420px;padding:32px;background:#fff;border-radius:16px;text-align:center">
<p style="margin:0 0 8px;font-weight:600">The Print's Project</p><h1 style="margin:0 0 12px;font-size:22px">${title}</h1>
<p style="margin:0;color:#52525b;line-height:1.5">${text}</p></main></body></html>`;
}

/** Stops a sign-in in progress (the owner pressed Cancel, or started again). */
export function cancelOAuth() {
  pending?.finish({ ok: false, error: 'cancelled' });
}

/** Starts the one-time callback server and returns the address Google should come back to. */
export function prepareOAuth(): Promise<string> {
  cancelOAuth();
  return new Promise((resolve, reject) => {
    let finished = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH || !pending || pending.server !== server) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(
        code
          ? page('Go back to the shop app', 'Your sign-in finishes there. You can close this tab.')
          : page('Sign-in did not finish', 'Go back to the shop app and try again.'),
      );
      pending.finish(code ? { ok: true, code } : { ok: false, error: error ?? 'Google did not return a sign-in code.' });
    });
    const entry: Pending = {
      server,
      redirectTo: '',
      finish: () => {},
    };
    entry.finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(entry.timer);
      server.close();
      if (pending === entry) pending = null;
      waiters.get(entry)?.(result);
      waiters.delete(entry);
    };
    server.once('error', reject);
    // 127.0.0.1 only: nothing on the network can reach it
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no port'));
      entry.redirectTo = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
      pending = entry;
      resolve(entry.redirectTo);
    });
  });
}

const waiters = new Map<Pending, (result: OAuthResult) => void>();

/**
 * Opens Supabase's Google sign-in page in the browser and waits for the
 * callback. Only a Supabase /auth/v1/authorize URL that returns to our own
 * callback server is opened, so the renderer can't use this to open anything else.
 */
export function runOAuth(authorizeUrl: unknown, onCallback: () => void): Promise<OAuthResult> {
  const entry = pending;
  if (!entry) return Promise.resolve({ ok: false, error: 'Sign-in was not started.' });
  let url: URL;
  try {
    url = new URL(String(authorizeUrl));
  } catch {
    return Promise.resolve({ ok: false, error: 'Bad sign-in address.' });
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const allowed =
    (url.protocol === 'https:' || (local && url.protocol === 'http:')) &&
    url.pathname.endsWith('/auth/v1/authorize') &&
    url.searchParams.get('provider') === 'google' &&
    url.searchParams.get('redirect_to') === entry.redirectTo;
  if (!allowed) {
    entry.finish({ ok: false, error: 'Bad sign-in address.' });
    return Promise.resolve({ ok: false, error: 'Bad sign-in address.' });
  }
  return new Promise((resolve) => {
    waiters.set(entry, (result) => {
      if (result.ok) onCallback();
      resolve(result);
    });
    entry.timer = setTimeout(() => entry.finish({ ok: false, error: 'Sign-in timed out. Try again.' }), TIMEOUT_MS);
    void shell.openExternal(url.toString()).catch(() => entry.finish({ ok: false, error: 'Could not open the browser.' }));
  });
}
