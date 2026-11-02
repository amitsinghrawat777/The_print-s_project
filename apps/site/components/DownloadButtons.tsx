import { siteEnv } from '@/lib/env';
import type { DesktopOs } from '@/lib/os';
import { buttonClass } from './ui';

const TARGETS = {
  windows: { label: 'Download for Windows', note: 'Windows 10 or 11 · .exe installer', url: siteEnv.downloadWindows },
  mac: { label: 'Download for Mac', note: 'macOS · .dmg', url: siteEnv.downloadMac },
} as const;

/**
 * The installer buttons, with the visitor's own system first. Until an
 * installer is published (no URL set) it shows a status, not a dead button.
 */
export function DownloadButtons({ os, dark = false }: { os: DesktopOs; dark?: boolean }) {
  const order: (keyof typeof TARGETS)[] = os === 'mac' ? ['mac', 'windows'] : ['windows', 'mac'];
  const [main, other] = order.map((k) => TARGETS[k]);
  const mainTarget = main.url ? main : other.url ? other : null;
  const otherTarget = mainTarget === main ? other : null;

  if (!mainTarget) {
    return (
      <div
        className={`flex items-start gap-3 rounded-2xl border border-dashed p-4 ${dark ? 'border-white/25 text-white/80' : 'border-neutral-300 text-neutral-700'}`}
        data-testid="download"
        role="status"
      >
        <ClockIcon />
        <div>
          <p className={`font-semibold ${dark ? 'text-white' : 'text-ink'}`}>The installer is coming soon</p>
          <p className="mt-1 text-sm">Until then, we install the app on your shop computer with you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="download">
      <a href={mainTarget.url!} className={buttonClass(dark ? 'light' : 'dark', 'lg')}>
        <DownloadIcon /> {mainTarget.label}
      </a>
      <p className={`text-sm ${dark ? 'text-white/60' : 'text-neutral-500'}`}>
        {mainTarget.note}
        {otherTarget?.url && (
          <>
            {' · '}
            <a href={otherTarget.url} className="underline underline-offset-2">{otherTarget.label.replace('Download for', 'Also for')}</a>
          </>
        )}
      </p>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden>
      <path d="M10 3v10m0 0 4-4m-4 4-4-4M4 16h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 size-5 shrink-0" aria-hidden>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
