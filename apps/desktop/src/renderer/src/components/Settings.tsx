import { PAPER_SIZES, type MixedColorMode, type PaperSize } from '@prints/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { DesktopSettings, PrinterInfo } from '../../../ipc';
import { playChime } from '../lib/sound';
import { supabase } from '../lib/supabase';
import { SHOP_COLUMNS, type Shop } from '../lib/types';
import { Button, Card, ErrorNote, Spinner, Toggle } from './ui';

const WEB_URL = (import.meta.env.RENDERER_VITE_WEB_URL || 'http://localhost:3030').replace(/\/$/, '');

export function Settings({
  shop,
  printers,
  settings,
  onSettings,
  onShop,
  onRefreshPrinters,
}: {
  shop: Shop;
  printers: PrinterInfo[];
  settings: DesktopSettings;
  onSettings: (s: DesktopSettings) => void;
  onShop: (s: Shop) => void;
  onRefreshPrinters: () => void;
}) {
  async function patch(p: Partial<DesktopSettings>) {
    onSettings(await window.prints.setSettings(p));
  }

  const printerSelect = (kind: 'bwPrinter' | 'colorPrinter', label: string) => (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="font-medium">{label}</span>
      <select
        className="h-10 w-80 rounded-lg border border-slate-300 bg-white px-2"
        value={settings[kind] ?? ''}
        onChange={(e) => void patch({ [kind]: e.target.value || null })}
      >
        <option value="">System default{printers.find((p) => p.isDefault) ? ` (${printers.find((p) => p.isDefault)!.displayName})` : ''}</option>
        {printers.map((p) => (
          <option key={p.name} value={p.name}>{p.displayName}</option>
        ))}
        {settings[kind] && !printers.some((p) => p.name === settings[kind]) && <option value={settings[kind]!}>{settings[kind]} (not connected)</option>}
      </select>
    </label>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Printers" actions={<Button size="sm" variant="ghost" onClick={onRefreshPrinters}>Refresh list</Button>}>
        {printers.length === 0 && <ErrorNote>No printers found on this computer. Add one in your system settings, then press Refresh.</ErrorNote>}
        {printerSelect('bwPrinter', 'B&W printer')}
        {printerSelect('colorPrinter', 'Colour printer')}
        <p className="mt-2 text-sm text-slate-500">
          B&W pages go to the B&W printer and colour pages to the colour printer. With one printer, choose it for both.
        </p>
      </Card>

      <Card title="This computer">
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="font-medium">Start with the computer</p>
            <p className="text-sm text-slate-500">Opens in the tray at login so orders are never missed.</p>
          </div>
          <Toggle label="Start with the computer" checked={settings.openAtLogin} onChange={(v) => void patch({ openAtLogin: v })} />
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="font-medium">Sound for new orders</p>
            <button type="button" className="text-sm text-blue-700 hover:underline" onClick={playChime}>Play it</button>
          </div>
          <Toggle label="Sound for new orders" checked={settings.playSound} onChange={(v) => void patch({ playSound: v })} />
        </div>
      </Card>

      <ShopSettings shop={shop} onShop={onShop} />
      <QrPoster shop={shop} />
    </div>
  );
}

function ShopSettings({ shop, onShop }: { shop: Shop; onShop: (s: Shop) => void }) {
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address ?? '');
  const [duplex, setDuplex] = useState(shop.duplex_available);
  const [mixed, setMixed] = useState<MixedColorMode>(shop.mixed_color_mode);
  const [papers, setPapers] = useState<PaperSize[]>(shop.paper_sizes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    if (name.trim().length < 2) return setError('The shop name is too short.');
    if (papers.length === 0) return setError('Choose at least one paper size.');
    setBusy(true);
    const { data, error: err } = await supabase
      .from('shops')
      .update({ name: name.trim(), address: address.trim() || null, duplex_available: duplex, mixed_color_mode: mixed, paper_sizes: papers })
      .eq('id', shop.id)
      .select(SHOP_COLUMNS)
      .single<Shop>();
    setBusy(false);
    if (err) return setError(err.message);
    onShop(data);
    setSaved(true);
  }

  return (
    <Card title="Shop">
      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Name customers see</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Address</span>
          <input value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Both-sides printing</p>
            <p className="text-sm text-slate-500">Lets customers choose double-sided.</p>
          </div>
          <Toggle label="Both-sides printing" checked={duplex} onChange={setDuplex} />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Paper sizes offered</legend>
          <div className="mt-2 flex gap-4">
            {PAPER_SIZES.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={papers.includes(p)} onChange={(e) => setPapers((list) => (e.target.checked ? PAPER_SIZES.filter((x) => x === p || list.includes(x)) : list.filter((x) => x !== p)))} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Orders with both B&W and colour pages</legend>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="radio" name="mixed" checked={mixed === 'single_pass'} onChange={() => setMixed('single_pass')} className="mt-1" />
            <span><span className="font-medium">Print all on the colour printer</span> (simplest; B&W pages still cost the B&W price)</span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="radio" name="mixed" checked={mixed === 'split'} onChange={() => setMixed('split')} className="mt-1" />
            <span><span className="font-medium">Split between printers</span> (one-sided, single-copy orders only; you merge the sheets)</span>
          </label>
        </fieldset>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy && <Spinner />} Save shop</Button>
        </div>
      </div>
    </Card>
  );
}

function QrPoster({ shop }: { shop: Shop }) {
  const link = `${WEB_URL}/s/${shop.slug}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setQr);
  }, [link]);

  return (
    <Card title="QR code for the counter">
      <div className="flex items-center gap-6">
        {qr && <img src={qr} alt={`QR code for ${link}`} className="size-40 rounded-lg ring-1 ring-slate-200" />}
        <div className="space-y-3">
          <p className="selectable font-mono text-sm break-all">{link}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</Button>
            <Button size="sm" variant="primary" disabled={!qr} onClick={() => window.print()}>Print poster</Button>
          </div>
        </div>
      </div>
      {/* only this prints (see styles.css) */}
      <div id="qr-poster" className="hidden print:flex print:flex-col print:items-center print:justify-center print:gap-6 print:bg-white print:p-16 print:text-center">
        <p className="text-5xl font-bold">{shop.name}</p>
        <p className="text-3xl">Scan to print</p>
        {qr && <img src={qr} alt="" className="size-[420px]" />}
        <p className="text-xl">Upload your files, choose pages and colour, see the price.<br />No WhatsApp, no pen drive.</p>
        <p className="font-mono text-lg">{link}</p>
      </div>
    </Card>
  );
}
