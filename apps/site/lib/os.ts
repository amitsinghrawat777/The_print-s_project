export type DesktopOs = 'windows' | 'mac' | 'other';

export function detectOs(userAgent: string): DesktopOs {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad/i.test(userAgent)) return 'mac';
  return 'other';
}

/** Where to send someone after sign-in: only paths on this site. */
export function safeNext(next: string | null | undefined, fallback = '/onboarding'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
