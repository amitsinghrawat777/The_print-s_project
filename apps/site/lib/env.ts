// Public settings. Each NEXT_PUBLIC_ variable is written out in full so Next can
// build it into the browser bundle. See apps/site/.env.example.

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const siteEnv = {
  /** The customer app the QR codes point to. */
  webUrl: trimSlash(process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3030'),
  downloadWindows: process.env.NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL || null,
  downloadMac: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_URL || null,
  /** Email + password next to Google: development and automated checks only. */
  allowPasswordLogin: process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN === '1',
};

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See apps/site/.env.example',
    );
  }
  return { url, key };
}

/** False until an installer is published: download buttons are then left out, not shown dead. */
export const downloadsAvailable = Boolean(siteEnv.downloadWindows || siteEnv.downloadMac);

export const customerLink =(slug: string) => `${siteEnv.webUrl}/s/${slug}`;
