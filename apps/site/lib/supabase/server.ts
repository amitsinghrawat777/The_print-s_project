import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { supabaseConfig } from '../env';

/** A Supabase client acting as the signed-in owner (their session cookie), so row level security applies. */
export async function supabaseServer(): Promise<SupabaseClient> {
  // always per request: the auth client reads the clock (token expiry), which can't be prerendered
  await connection();
  const store = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

export interface OwnShop {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  is_accepting: boolean;
  paper_sizes: string[];
  rate_count: number;
}

/** The signed-in user, checked with Supabase Auth (not just read from the cookie). */
export async function currentUser(): Promise<{ sb: SupabaseClient; user: User | null }> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
}

/** The owner's shop (the desktop app opens the first one too), or null if they haven't made one yet. */
export async function ownShop(sb: SupabaseClient): Promise<OwnShop | null> {
  const { data, error } = await sb
    .from('shops')
    .select('id, name, slug, address, is_accepting, paper_sizes, shop_rates(count)')
    .order('created_at')
    .limit(1);
  if (error) throw new Error(`Could not load your shop: ${error.message}`);
  const row = data?.[0] as (Omit<OwnShop, 'rate_count'> & { shop_rates: { count: number }[] }) | undefined;
  if (!row) return null;
  const { shop_rates, ...shop } = row;
  return { ...shop, rate_count: shop_rates[0]?.count ?? 0 };
}
