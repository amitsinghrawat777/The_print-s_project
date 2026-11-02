import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import type { DesktopSettings, PrinterInfo } from '../../ipc';
import mark from './assets/p-mark.png';
import { JobDetail } from './components/JobDetail';
import { Login } from './components/Login';
import { QueueList } from './components/QueueList';
import { RateCard } from './components/RateCard';
import { Settings } from './components/Settings';
import { Button, ErrorNote, Spinner, Toggle } from './components/ui';
import { jobSummary } from './lib/format';
import { playChime } from './lib/sound';
import { configError, supabase } from './lib/supabase';
import { SHOP_COLUMNS, type Job, type Shop } from './lib/types';
import { useQueue, type Connection } from './lib/useQueue';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (configError) return <Centered><ErrorNote>{configError}</ErrorNote></Centered>;
  if (session === undefined) return <Centered><Spinner className="size-6 text-blue-600" /></Centered>;
  if (!session) return <Login />;
  return <SignedIn key={session.user.id} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex h-full items-center justify-center p-6">{children}</main>;
}

function SignedIn() {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('shops')
      .select(SHOP_COLUMNS)
      .order('created_at')
      .limit(1)
      .returns<Shop[]>()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setShop(data?.[0] ?? null);
      });
  }, []);

  if (error) return <Centered><ErrorNote>Could not load your shop: {error}</ErrorNote></Centered>;
  if (shop === undefined) return <Centered><Spinner className="size-6 text-blue-600" /></Centered>;
  if (shop === null) {
    return (
      <Centered>
        <div className="max-w-sm space-y-4 text-center">
          <p>This account has no shop yet. Ask us to set one up for you.</p>
          <Button onClick={() => void supabase.auth.signOut()}>Sign out</Button>
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

  async function setAccepting(value: boolean) {
    setPausing(true);
    const { data, error: err } = await supabase.from('shops').update({ is_accepting: value }).eq('id', shop.id).select(SHOP_COLUMNS).single<Shop>();
    setPausing(false);
    if (!err && data) onShop(data);
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
                <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 text-xs text-white">{jobs.filter((j) => j.status === 'new').length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className={shop.is_accepting ? 'text-emerald-700' : 'font-medium text-amber-700'}>
              {shop.is_accepting ? 'Taking orders' : 'Orders paused'}
            </span>
            <Toggle label="Taking orders" checked={shop.is_accepting} disabled={pausing} onChange={(v) => void setAccepting(v)} />
          </label>
          <Button size="sm" variant="ghost" onClick={() => void supabase.auth.signOut()}>Sign out</Button>
        </div>
      </header>

      {tab === 'orders' && (
        <div className="flex min-h-0 flex-1">
          <aside className="w-80 shrink-0 border-r border-slate-200 bg-slate-50">
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
                {!shop.is_accepting && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Orders are paused. Customers can't send new orders.</p>}
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
