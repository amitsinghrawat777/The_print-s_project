import { useState, type FormEvent } from 'react';
import logo from '../assets/wordmark-black.png';
import { supabase } from '../lib/supabase';
import { Button, ErrorNote, Spinner } from './ui';

/**
 * Email + password stays available only in development and test builds (the
 * demo shop and the automated checks use it). Shop builds sign in with Google only.
 */
const allowPassword = import.meta.env.DEV || import.meta.env.RENDERER_VITE_ALLOW_PASSWORD_LOGIN === '1';

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

export function Login() {
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setError(null);
    setBusy(true);
    try {
      const redirectTo = await window.prints.oauthPrepare();
      const { data, error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // ask which account every time: shop PCs are often shared
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (err || !data.url) throw new Error(err?.message ?? 'Could not start Google sign-in.');
      setWaiting(true);
      const result = await window.prints.oauthRun(data.url);
      setWaiting(false);
      if (!result.ok) {
        if (result.error !== 'cancelled') setError(result.error);
        return;
      }
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.code);
      if (exchangeError) throw new Error('Sign-in could not be finished. Please try again.');
      // signed in: App switches to the shop screen on its own
    } catch (e) {
      setWaiting(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div>
          <img src={logo} alt="The Print's Project" className="h-auto w-40" />
          <h1 className="mt-5 text-2xl font-semibold">Shop login</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in once with your Google account. The app stays signed in on this computer.</p>
        </div>

        {waiting ? (
          <div className="space-y-4 rounded-xl bg-accent-soft p-5 text-center" role="status" data-testid="google-waiting">
            <Spinner className="size-6" />
            <p className="font-medium">Finish signing in in your browser</p>
            <p className="text-sm text-slate-600">Choose your Google account there, then come back here.</p>
            <Button variant="ghost" size="sm" onClick={() => window.prints.oauthCancel()}>Cancel</Button>
          </div>
        ) : (
          <Button variant="secondary" size="lg" className="w-full" disabled={busy} onClick={() => void google()} data-testid="google-sign-in">
            {busy ? <Spinner /> : <GoogleMark />}
            Continue with Google
          </Button>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}

        {allowPassword && !waiting && <PasswordLogin />}
      </div>
    </main>
  );
}

/** Development and test builds only. */
function PasswordLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message);
  }

  const input = 'mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent-line';
  return (
    <form onSubmit={submit} className="space-y-3 border-t border-dashed border-slate-300 pt-5">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Developer sign-in</p>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy && <Spinner />}
        Sign in
      </Button>
    </form>
  );
}
