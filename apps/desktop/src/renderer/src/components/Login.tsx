import { useState, type FormEvent } from 'react';
import logo from '../assets/wordmark-black.png';
import { supabase } from '../lib/supabase';
import { Button, ErrorNote, Spinner } from './ui';

export function Login() {
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

  return (
    <main className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div>
          <img src={logo} alt="The Print's Project" className="h-auto w-40" />
          <h1 className="mt-5 text-2xl font-semibold">Shop login</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in once. The app stays signed in on this computer.</p>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />}
          Sign in
        </Button>
      </form>
    </main>
  );
}
