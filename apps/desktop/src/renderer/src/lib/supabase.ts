import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.RENDERER_VITE_SUPABASE_URL;
const key = import.meta.env.RENDERER_VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !key ? 'This build has no Supabase settings. Copy apps/desktop/.env.example to .env and rebuild.' : null;

/**
 * The owner's own client: publishable key + their login, so Row Level Security
 * limits it to their shop. The login is stored by the main process, encrypted.
 */
export const supabase = createClient(url || 'http://invalid.localhost', key || 'missing', {
  auth: {
    storageKey: 'prints-owner',
    storage: {
      getItem: (k) => window.prints.session.get(k),
      setItem: (k, v) => window.prints.session.set(k, v),
      removeItem: (k) => window.prints.session.remove(k),
    },
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
