'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';

export function LoginForm({ next, error: initialError, allowPassword }: { next: string; error: string | null; allowPassword: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'google' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  async function google() {
    setBusy('google');
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: err } = await supabaseBrowser().auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    // on success the browser is already on its way to Google
    if (err) {
      setBusy(null);
      setError(err.message);
    }
  }

  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy('password');
    setError(null);
    const { error: err } = await supabaseBrowser().auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (err) {
      setBusy(null);
      setError(err.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-4 text-left">
      {error && <ErrorNote>Sign-in did not work: {error}</ErrorNote>}
      <Button variant="light" size="lg" className="w-full" disabled={busy !== null} onClick={() => void google()}>
        {busy === 'google' ? <Spinner /> : <GoogleIcon />} Continue with Google
      </Button>

      {allowPassword && (
        <form onSubmit={(e) => void password(e)} className="space-y-3 rounded-2xl border border-dashed border-neutral-300 p-4">
          <p className="text-xs font-medium text-neutral-500">Development only: email and password</p>
          <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className="h-11 w-full rounded-xl bg-white px-3.5 ring-1 ring-neutral-200 outline-none focus:ring-2 focus:ring-accent" />
          <input name="password" type="password" required autoComplete="current-password" placeholder="Password" aria-label="Password" className="h-11 w-full rounded-xl bg-white px-3.5 ring-1 ring-neutral-200 outline-none focus:ring-2 focus:ring-accent" />
          <Button type="submit" variant="dark" className="w-full" disabled={busy !== null}>
            {busy === 'password' && <Spinner />} Sign in
          </Button>
        </form>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
