import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { currentUser } from '@/lib/supabase/server';
// the solid version of the wordmark: the gradient one washes out at header size
import wordmark from '../public/brand/mark.png';
import { MobileMenu } from './MobileMenu';
import { ButtonLink } from './ui';

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="The Print's Project home">
          <Image src={wordmark} alt="" priority sizes="100px" className="h-6 w-auto" />
        </Link>
        <nav className="hidden items-center gap-1 text-sm text-neutral-600 sm:flex">
          <Link href="/#how" className="rounded-full px-3 py-1.5 hover:bg-neutral-100 hover:text-ink">How it works</Link>
          <Link href="/#features" className="rounded-full px-3 py-1.5 hover:bg-neutral-100 hover:text-ink">Features</Link>
          <Link href="/download" className="rounded-full px-3 py-1.5 hover:bg-neutral-100 hover:text-ink">Download</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Suspense fallback={<Account signedIn={false} />}>
            <AccountLinks />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function AccountLinks() {
  const { user } = await currentUser();
  return <Account signedIn={!!user} />;
}

function Account({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      {signedIn ? (
        <ButtonLink href="/dashboard" variant="dark" size="sm">Dashboard</ButtonLink>
      ) : (
        <>
          {/* on phones, Sign in lives in the menu */}
          <span className="hidden sm:contents">
            <ButtonLink href="/login" variant="ghost" size="sm">Sign in</ButtonLink>
          </span>
          <ButtonLink href="/onboarding" variant="dark" size="sm">Set up your shop</ButtonLink>
        </>
      )}
      <MobileMenu signedIn={signedIn} />
    </>
  );
}
