'use client';

import { PAPER_SIZES, type PaperSize } from '@prints/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { DownloadButtons } from '@/components/DownloadButtons';
import { QrPoster } from '@/components/QrPoster';
import { Button, ButtonLink, ErrorNote, Spinner } from '@/components/ui';
import { customerLink, downloadsAvailable, siteEnv } from '@/lib/env';
import { detectOs } from '@/lib/os';
import { buildRateRows, defaultDraft, keyOf, RATE_COLUMNS } from '@/lib/rates';
import { nextSlug, slugify, slugProblem } from '@/lib/slug';
import { supabaseBrowser } from '@/lib/supabase/client';

type Step = 'shop' | 'prices' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'shop', label: 'Your shop' },
  { id: 'prices', label: 'Paper & prices' },
  { id: 'done', label: 'Go live' },
];

const input =
  'h-12 w-full rounded-xl bg-white px-4 text-base ring-1 ring-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-accent aria-invalid:ring-red-400';

const noSubscribe = () => () => {};

export function Wizard({ email }: { email: string }) {
  const [step, setStep] = useState<Step>('shop');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugTaken, setSlugTaken] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [papers, setPapers] = useState<PaperSize[]>(['A4']);
  const [duplex, setDuplex] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the shop row exists, so pressing Create again only retries the prices. */
  const [created, setCreated] = useState<{ id: string; slug: string; name: string } | null>(null);
  const os = useSyncExternalStore(noSubscribe, () => detectOs(navigator.userAgent), () => 'windows' as const);

  // Each step starts at the top of the page, with keyboard and screen reader focus on its
  // heading. Not on the first render: the shop name field has focus then.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // braces matter: newer browsers return a Promise from scrollTo, and an effect may only return a cleanup
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const nameProblem =name.trim().length < 2 ? 'Enter your shop’s name.' : null;
  const linkProblem = slugTaken === slug ? `That link is taken. Try ${nextSlug(slug)}?` : slugProblem(slug);

  function nameChanged(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function shopNext(e: FormEvent) {
    e.preventDefault();
    setShowProblems(true);
    if (nameProblem || linkProblem) return;
    setStep('prices');
  }

  function togglePaper(paper: PaperSize) {
    setPapers((list) => (list.includes(paper) ? list.filter((p) => p !== paper) : PAPER_SIZES.filter((p) => p === paper || list.includes(p))));
  }

  async function create() {
    setError(null);
    if (papers.length === 0) return setError('Choose at least one paper size.');
    try {
      buildRateRows('check', papers, duplex, draft);
    } catch (e) {
      return setError((e as Error).message);
    }

    setBusy(true);
    const sb = supabaseBrowser();
    let shop = created;
    if (!shop) {
      const { data, error: err } = await sb
        .from('shops')
        .insert({
          name: name.trim(),
          slug,
          address: address.trim() || null,
          duplex_available: duplex,
          paper_sizes: papers,
        })
        .select('id, slug, name')
        .single<{ id: string; slug: string; name: string }>();
      if (err) {
        setBusy(false);
        if (err.code === '23505') {
          // the only unique column a new shop can clash on is its link
          setSlugTaken(slug);
          setShowProblems(true);
          setStep('shop');
          return;
        }
        return setError(`Could not create your shop: ${err.message}`);
      }
      shop = data;
      setCreated(data);
    }

    const { error: rateErr } = await sb
      .from('shop_rates')
      .upsert(buildRateRows(shop.id, papers, duplex, draft), { onConflict: 'shop_id,paper_size,color_mode,sides' });
    setBusy(false);
    if (rateErr) return setError(`Your shop was created, but the prices did not save (${rateErr.message}). Press the button again to retry.`);
    setStep('done');
  }

  const index = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <ol className="mb-10 grid grid-cols-3 gap-2" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={i === index ? 'step' : undefined}>
            <div className={`h-1.5 rounded-full ${i <= index ? 'bg-ink' : 'bg-neutral-200'}`} />
            <p className={`mt-2 text-xs font-medium sm:text-sm ${i <= index ? 'text-ink' : 'text-neutral-500'}`}>{s.label}</p>
          </li>
        ))}
      </ol>

      {step === 'shop' && (
        <form onSubmit={shopNext} noValidate className="space-y-8">
          <div>
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold tracking-tight outline-none">Tell us about your shop</h1>
            <p className="mt-2 text-neutral-600">Customers see this when they scan your QR code.</p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Shop name</span>
            <input
              className={input}
              value={name}
              maxLength={80}
              autoFocus
              placeholder="Sharma Xerox & Print"
              onChange={(e) => nameChanged(e.target.value)}
              name="shop-name"
              aria-invalid={showProblems && !!nameProblem}
              aria-describedby={showProblems && nameProblem ? 'name-problem' : undefined}
            />
            {showProblems && nameProblem && <span id="name-problem" className="text-sm text-red-700">{nameProblem}</span>}
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">
              Address <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            <input className={input} value={address} maxLength={200} placeholder="Near College Gate, Dehradun" onChange={(e) => setAddress(e.target.value)} name="address" />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Your link</span>
            <div className="flex h-12 items-center overflow-hidden rounded-xl bg-white ring-1 ring-neutral-200 focus-within:ring-2 focus-within:ring-accent">
              <span className="hidden shrink-0 pl-4 text-neutral-500 sm:block">{siteEnv.webUrl.replace(/^https?:\/\//, '')}/s/</span>
              <span className="shrink-0 pl-4 text-neutral-500 sm:hidden">…/s/</span>
              <input
                className="h-full min-w-0 flex-1 bg-transparent pr-4 text-base outline-none"
                value={slug}
                maxLength={40}
                name="slug"
                aria-invalid={showProblems && !!linkProblem}
                aria-describedby="slug-help"
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
                }}
              />
            </div>
            {showProblems && linkProblem ? (
              <span id="slug-help" className="flex flex-wrap items-center gap-2 text-sm text-red-700" data-testid="slug-problem">
                {linkProblem}
                {slugTaken === slug && (
                  <button type="button" className="font-semibold underline" onClick={() => setSlug(nextSlug(slug))}>
                    Use it
                  </button>
                )}
              </span>
            ) : (
              <span id="slug-help" className="block text-sm text-neutral-500">
                Your QR code will open <span className="font-mono break-all text-ink">{customerLink(slug || 'your-shop')}</span>. You
                can&apos;t change it later.
              </span>
            )}
          </label>

          <div className="flex justify-end">
            <Button type="submit" variant="dark" size="lg">Continue</Button>
          </div>
        </form>
      )}

      {step === 'prices' && (
        <div className="space-y-8">
          <div>
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold tracking-tight outline-none">Paper and prices</h1>
            <p className="mt-2 text-neutral-600">
              <b className="font-semibold text-ink">These are sample prices. Check they match your counter:</b> customers pay
              what you set here. You can change them any time in the shop app.
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Paper sizes you print</legend>
            <div className="flex flex-wrap gap-2 pt-2">
              {PAPER_SIZES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={papers.includes(p)}
                  onClick={() => togglePaper(p)}
                  className={`h-10 rounded-full px-4 text-sm font-medium ring-1 transition-colors ${
                    papers.includes(p) ? 'bg-ink text-white ring-ink' : 'bg-white text-neutral-700 ring-neutral-200 hover:ring-neutral-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-white p-4 ring-1 ring-neutral-200">
            <span>
              <span className="block font-medium">My printer can print both sides</span>
              <span className="block text-sm text-neutral-500">Customers can then choose double-sided, priced per sheet.</span>
            </span>
            <input type="checkbox" className="size-5 accent-[#0b0b0c]" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} name="duplex" />
          </label>

          <div className="space-y-4">
            {papers.map((paper) => (
              <div key={paper} className="rounded-2xl bg-white p-4 ring-1 ring-neutral-200 sm:p-5">
                <p className="mb-3 font-semibold">{paper}</p>
                <div className={`grid gap-3 ${duplex ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
                  {RATE_COLUMNS.filter((c) => duplex || c.sides === 'single').map((c) => {
                    const key = keyOf(paper, c.color, c.sides);
                    return (
                      <label key={key} className="space-y-1">
                        <span className="block text-xs text-neutral-600">{c.label}</span>
                        <span className="flex h-11 items-center rounded-xl bg-paper ring-1 ring-neutral-200 focus-within:ring-2 focus-within:ring-accent">
                          <span className="pl-3 text-neutral-500">₹</span>
                          <input
                            inputMode="decimal"
                            className="h-full w-full min-w-0 bg-transparent px-1.5 tabular-nums outline-none"
                            value={draft[key] ?? ''}
                            placeholder="—"
                            aria-label={`${paper}, ${c.label}, ${c.unit}`}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          />
                        </span>
                        <span className="block text-xs text-neutral-500">{c.unit}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-sm text-neutral-500">Leave a price empty if you don&apos;t offer it.</p>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={busy || !!created} onClick={() => setStep('shop')}>← Back</Button>
            <Button variant="dark" size="lg" disabled={busy} onClick={() => void create()} data-testid="create-shop">
              {busy && <Spinner />} Create shop with these prices
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && created && (
        <div className="space-y-8">
          <div>
            <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold tracking-tight outline-none">{created.name} is ready</h1>
            <p className="mt-2 text-neutral-600">Two things left: put the QR code on your counter, and install the shop app.</p>
          </div>

          <section className="rounded-3xl bg-white p-6 ring-1 ring-neutral-200 sm:p-8">
            <h2 className="mb-5 text-lg font-semibold">1. Your QR code</h2>
            <QrPoster name={created.name} slug={created.slug} />
          </section>

          <section className="rounded-3xl bg-ink p-6 text-white sm:p-8">
            <h2 className="text-lg font-semibold">2. The shop app</h2>
            <p className="mt-2 mb-6 text-white/70">
              Install it on the computer next to your printer, then press <b className="text-white">Continue with Google</b> and choose{' '}
              <b className="text-white">{email}</b>. Your shop opens by itself.
            </p>
            <DownloadButtons os={os} dark />
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <a href={customerLink(created.slug)} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
              Try it as a customer →
            </a>
            <ButtonLink href="/dashboard" variant="light">Go to your dashboard</ButtonLink>
          </div>
        </div>
      )}

      {step !== 'done' && (
        <p className="mt-12 text-center text-sm text-neutral-500">
          Signed in as {email}
          {downloadsAvailable && (
            <>
              {' · '}
              <Link href="/download" className="underline underline-offset-2">Download the app</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
