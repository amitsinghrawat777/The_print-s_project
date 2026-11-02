'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../env';

let client: SupabaseClient | undefined;

/** Browser client. The session lives in cookies, so server pages see the same sign-in. */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const { url, key } = supabaseConfig();
    client = createBrowserClient(url, key);
  }
  return client;
}
