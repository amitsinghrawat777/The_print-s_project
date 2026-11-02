import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/os';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Google sends the owner back here with a one-time code. Trading it for a
 * session needs the PKCE verifier the browser saved in a cookie before leaving,
 * so a code on its own is useless to anyone else.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  let problem = url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'Google did not send a sign-in code.';

  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    problem = error.message;
  }
  const back = new URL('/login', url.origin);
  back.searchParams.set('next', next);
  back.searchParams.set('error', problem);
  return NextResponse.redirect(back);
}
