import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from '@prints/shared';
import { env } from './env';

let client: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS, so every route must check the caller's
 * job access token itself (see requireJob in ./api).
 */
export function db(): SupabaseClient {
  client ??= createClient(env().SUPABASE_URL, env().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function bucket() {
  return db().storage.from(STORAGE_BUCKET);
}
