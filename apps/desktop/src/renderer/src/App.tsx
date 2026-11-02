import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import type { DesktopSettings, PrinterInfo } from '../../ipc';
import mark from './assets/p-mark.png';
import { JobDetail } from './components/JobDetail';
import { Login } from './components/Login';
import { QueueList } from './components/QueueList';
import { RateCard } from './components/RateCard';
import { Settings } from './components/Settings';
import { Button, ConfirmDialog, ErrorNote, Spinner, Toggle } from './components/ui';
import { jobSummary, nextMorning, whenLabel } from './lib/format';
import { playChime } from './lib/sound';
import { configError, supabase } from './lib/supabase';
import { SHOP_COLUMNS, type Job, type Shop } from './lib/types';
import { useQueue, type Connection } from './lib/useQueue';

/** The onboarding website, where owners create their shop. */
const SITE_URL = (import.meta.env.RENDERER_VITE_SITE_URL || 'http://localhost:3040').replace(/\/$/, '');

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (configError) return <Centered><ErrorNote>{configError}</ErrorNote></Centered>;
  if (session === undefined) return <Centered><Spinner className="size-6 text-accent" /></Centered>;
  if (!session) return <Login />;
  return <SignedIn key={session.user.id} email={session.user.email ?? ''} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex h-full items-center justify-center p-6">{children}</main>;
}

function SignedIn({ email }: { email: string }) {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    const { data, error: err } = await supabase.from('shops').select(SHOP_COLUMNS).order('created_at').limit(1).returns<Shop[]>();
    setChecking(false);
    if (err) setError(err.message);
    else setShop(data?.[0] ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Centered><ErrorNote>Could not load your shop: {error}</ErrorNote></Centered>;
  if (shop === undefined) return <Centered><Spinner className="size-6 text-accent" /></Centered>;
  if (shop === null) {
    return (
      <Centered>
        <div className="max-w-sm space-y-4 text-center">
          <p className="text-lg font-medium">No shop for this account yet</p>
          <p className="text-sm text-slate-600">
            You're signed in as <span className="font-medium text-slate-900">{email}</span>. Set up your shop on our website with this
            Google account, then press Check again. Or sign out and choose the account your shop uses.
          </p>
          <div className="flex justify-center gap-2">
            {/* opens in the browser (see setWindowOpenHandler in main) */}
            <Button variant="primary" onClick={() => window.open(`${SITE_URL}/onboarding`, '_blank')}>Set up your shop</Button>
            <Button disabled={checking} onClick={() => void load()} data-testid="check-shop">
              {checking && <Spinner />} Check again
            </Button>
            <Button onClick={() => void supabase.auth.signOut()}>Sign out</Button>
          </div>
        </div>
      </Centered>
    );
  }
  return <Shell shop={shop} onShop={setShop} />;
}

type Tab = 'orders' | 'rates' | 'settings';

function Shell({ shop, onShop }: { shop: Shop; onShop: (s: Shop) => void }) {
  const [tab, setTab] = useState<Tab>('orders');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [pausing, setPausing] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);

  const loadPrinters = useCallback(() => void window.prints.listPrinters().then(setPrinters), []);
  useEffect(() => {
    void window.prints.getSettings().then(setSettings);
    loadPrinters();
  }, [loadPrinters]);

  const onNewJob = useCallback(
    (job: Job) => {
      if (settings?.playSound !== false) playChime();
      window.prints.newJob({ jobId: job.id, token: job.token ?? '', summary: jobSummary(job) });
    },
    [settings?.playSound],
  );
  const { jobs, loaded, error, connection, refresh } = useQueue(shop.id, onNewJob);

  // The shop can change without this window doing it: the 6 am auto-resume, or
  // the owner on another computer. Realtime brings it in; a slow poll backs it up.
  useEffect(() => {
    const reload = () =>
      void supabase
        .from('shops')
        .select(SHOP_COLUMNS)
        .eq('id', shop.id)
        .single<Shop>()
        .then(({ data }) => data && onShop(data));
    const channel = supabase
      .channel(`shop-${shop.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shops', filter: `id=eq.${shop.id}` }, reload)
      .subscribe((s) => s === 'SUBSCRIBED' && reload());
    const timer = window.setInterval(reload, 60_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [shop.id, onShop]);

  // clicking a notification opens that order
  useEffect(
    () =>
      window.prints.onOpenJob((id) => {
        setTab('orders');
        setSelectedId(id);
      }),
    [],
  );

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  const [pauseError, setPauseError] = useState<string | null>(null);
  async function setAccepting(value: boolean) {
    setConfirmPause(false);
    setPausing(true);
    setPauseError(null);
    const { data, error: err } = await supabase.from('shops').update({ is_accepting: value }).eq('id', shop.id).select(SHOP_COLUMNS).single<Shop>();
    setPausing(false);
    if (err || !data) setPauseError(err?.message ?? 'Could not change this. Try again.');
    else onShop(data);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <img src={mark} alt="The Print's Project" className="size-7 shrink-0" />
        <div className="min-w-0 border-l border-slate-200 pl-4">
          <p className="truncate font-semibold" data-testid="shop-name">{shop.name}</p>
        </div>
        <ConnectionDot connection={connection} />
        <nav className="ml-4 flex gap-1" aria-label="Sections">
          {(
            [
              ['orders', 'Orders'],
              ['rates', 'Rate card'],
              ['settings', 'Settings'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`h-9 rounded-lg px-3 text-sm font-medium ${tab === id ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {label}
              {id === 'orders' && jobs.some((j) => j.status === 'new') && (
                <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs text-white">{jobs.filter((j) => j.status === 'new').length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className={shop.is_accepting ? 'text-emerald-700' : 'font-medium text-amber-700'}>
              {shop.is_accepting ? 'Taking orders' : 'Orders paused'}
            </span>
            {/* pausing turns customers away, so it asks first; resuming doesn't */}
            <Toggle
              label="Taking orders"
              tone="status"
              checked={shop.is_accepting}
              disabled={pausing}
              onChange={(v) => (v ? void setAccepting(true) : setConfirmPause(true))}
            />
          </label>
          <Button size="sm" variant="ghost" onClick={() => void supabase.auth.signOut()}>Sign out</Button>
        </div>
      </header>

      {!shop.is_accepting && (
        <div className="flex shrink-0 items-center gap-3 bg-amber-100 px-4 py-2.5 text-amber-950" role="status" data-testid="paused-banner">
          <span className="size-2.5 shrink-0 rounded-full bg-amber-600" aria-hidden />
          <p className="flex-1 text-sm">
            <span className="font-semibold">Orders are paused.</span> Customers who scan your QR code can't send files right now.
            {shop.resume_at && <> They turn back on by themselves {whenLabel(new Date(shop.resume_at))}.</>}
          </p>
          <Button size="sm" variant="warning" disabled={pausing} onClick={() => void setAccepting(true)}>
            {pausing && <Spinner />} Resume orders
          </Button>
        </div>
      )}
      {pauseError && <div className="shrink-0 px-4 pt-3"><ErrorNote>{pauseError}</ErrorNote></div>}
      {confirmPause && (
        <ConfirmDialog
          title="Pause new orders?"
          confirmLabel="Pause orders"
          cancelLabel="Keep taking orders"
          onConfirm={() => void setAccepting(false)}
          onCancel={() => setConfirmPause(false)}
        >
          <p>Customers who scan your QR code will see that the shop isn't taking orders.</p>
          <p className="mt-2">
            Orders turn back on by themselves <span className="font-medium text-slate-900">{whenLabel(nextMorning())}</span>, or sooner when you
            resume them.
          </p>
          <p className="mt-2">Orders already sent stay in your queue.</p>
        </ConfirmDialog>
      )}

      {tab === 'orders' && (
        <div className="flex min-h-0 flex-1">
          {/* below 1024 px the queue shrinks to a column of tokens so the preview keeps its room */}
          <aside className="w-[88px] shrink-0 border-r border-slate-200 bg-slate-50 lg:w-80">
            {!loaded && !error && <p className="flex items-center gap-2 p-4 text-sm text-slate-500"><Spinner /> Loading orders…</p>}
            {error && <div className="p-3"><ErrorNote>{error}</ErrorNote></div>}
            {loaded && <QueueList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />}
          </aside>
          <main className="min-w-0 flex-1">
            {selected && settings ? (
              <JobDetail key={selected.id} job={selected} printers={printers} settings={settings} onChanged={() => void refresh()} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                <p className="text-lg">Pick an order on the left</p>
                <p className="text-sm">New orders appear instantly with a sound.</p>
              </div>
            )}
          </main>
        </div>
      )}
      {tab === 'rates' && <div className="flex-1 overflow-y-auto"><RateCard shop={shop} /></div>}
      {tab === 'settings' && settings && (
        <div className="flex-1 overflow-y-auto">
          <Settings shop={shop} printers={printers} settings={settings} onSettings={setSettings} onShop={onShop} onRefreshPrinters={loadPrinters} />
        </div>
      )}
    </div>
  );
}

function ConnectionDot({ connection }: { connection: Connection }) {
  const style = { live: 'bg-emerald-500', connecting: 'bg-amber-400', offline: 'bg-red-500' }[connection];
  const label = { live: 'Live', connecting: 'Connecting…', offline: 'Offline, retrying' }[connection];
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500" title={label} data-testid="connection">
      <span className={`size-2 rounded-full ${style}`} />
      {label}
    </span>
  );
}
