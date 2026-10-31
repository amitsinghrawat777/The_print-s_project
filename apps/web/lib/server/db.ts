import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS: only use after the request is authorized. */
export function db(): SupabaseClient {
  if (!client) {
    const e = env();
    client = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
