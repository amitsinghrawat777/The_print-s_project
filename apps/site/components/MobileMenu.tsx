'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/download', label: 'Download' },
];

/** The header links on phones, where they don't fit in the bar. */
export function MobileMenu({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-neutral-100"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden>
          {open ? (
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M4 8h16M4 16h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open && (
        <>
          {/* absolute, not fixed: the header's backdrop blur makes it the box fixed children are placed in */}
          <div className="absolute inset-x-0 top-full z-20 h-screen bg-black/20" onClick={close} aria-hidden data-testid="menu-backdrop" />
          <nav id="mobile-menu" aria-label="Menu" className="absolute inset-x-0 top-full z-30 border-b border-neutral-200 bg-paper px-4 pt-2 pb-6 shadow-lg">
            <ul>
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={close} className="flex h-13 items-center border-b border-neutral-200 text-base font-medium">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href={signedIn ? '/dashboard' : '/login'} onClick={close} className="flex h-13 items-center text-base font-medium">
                  {signedIn ? 'Dashboard' : 'Sign in'}
                </Link>
              </li>
            </ul>
          </nav>
        </>
      )}
    </div>
  );
}
