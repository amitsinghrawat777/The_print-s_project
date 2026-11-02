import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  // 303: the browser follows with a GET
  return NextResponse.redirect(new URL('/', request.nextUrl.origin), 303);
}
