import type { ColorMode, PaperSize, Sides } from '@prints/shared';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Shop } from '../lib/types';
import { Button, Card, ErrorNote, Spinner } from './ui';

interface RateRow {
  paper_size: PaperSize;
  color_mode: ColorMode;
  sides: Sides;
  price_paise: number;
}

const COLUMNS: { color: ColorMode; sides: Sides; label: string; unit: string }[] = [
  { color: 'bw', sides: 'single', label: 'B&W, one side', unit: 'per page' },
  { color: 'color', sides: 'single', label: 'Colour, one side', unit: 'per page' },
  { color: 'bw', sides: 'double', label: 'B&W, both sides', unit: 'per sheet' },
  { color: 'color', sides: 'double', label: 'Colour, both sides', unit: 'per sheet' },
];

const keyOf = (paper: string, color: string, sides: string) => `${paper}|${color}|${sides}`;

/** "2", "2.5", "" → paise, or null for "not offered". Throws on nonsense. */
function toPaise(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) throw new Error(`"${text}" is not a price`);
  const paise = Math.round(Number(t) * 100);
  if (paise > 100000) throw new Error('Prices must be ₹1,000 or less');
  return paise;
}

const toText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

export function RateCard({ shop }: { shop: Shop }) {
  const [saved, setSaved] = useState<Map<string, number> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error: err } = await supabase.from('shop_rates').select('paper_size, color_mode, sides, price_paise').eq('shop_id', shop.id).returns<RateRow[]>();
    if (err) return setError(err.message);
    const map = new Map((data ?? []).map((r) => [keyOf(r.paper_size, r.color_mode, r.sides), r.price_paise]));
    setSaved(map);
    setDraft(Object.fromEntries([...map].map(([k, v]) => [k, toText(v)])));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id]);

  const columns = COLUMNS.filter((c) => c.sides === 'single' || shop.duplex_available);

  async function save() {
    if (!saved) return;
    setError(null);
    setNotice(null);
    const upserts: (RateRow & { shop_id: string })[] = [];
    const removals: string[] = [];
    try {
      for (const paper of shop.paper_sizes) {
        for (const c of columns) {
          const k = keyOf(paper, c.color, c.sides);
          const value = toPaise(draft[k] ?? '');
          if (value === null && saved.has(k)) removals.push(k);
          if (value !== null && value !== saved.get(k)) {
            upserts.push({ shop_id: shop.id, paper_size: paper, color_mode: c.color, sides: c.sides, price_paise: value });
          }
        }
        if (toPaise(draft[keyOf(paper, 'bw', 'single')] ?? '') === null) {
          throw new Error(`${paper} needs a B&W one-side price, or turn ${paper} off in Settings.`);
        }
      }
    } catch (e) {
      return setError((e as Error).message);
    }

    setBusy(true);
    if (upserts.length) {
      const { error: err } = await supabase.from('shop_rates').upsert(upserts);
      if (err) {
        setBusy(false);
        return setError(err.message);
      }
    }
    for (const k of removals) {
      const [paper, color, sides] = k.split('|');
      const { error: err } = await supabase.from('shop_rates').delete().match({ shop_id: shop.id, paper_size: paper, color_mode: color, sides });
      if (err) {
        setBusy(false);
        return setError(err.message);
      }
    }
    setBusy(false);
    await load();
    setNotice(upserts.length + removals.length ? 'Saved. New orders use these prices; orders already sent keep theirs.' : 'Nothing changed.');
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Rate card</h1>
        <p className="text-sm text-slate-500">Customers see these prices live while they choose options. Leave a box empty to not offer that option.</p>
      </div>
      <Card>
        {!saved ? (
          <p className="flex items-center gap-2 text-slate-500"><Spinner /> Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-3 font-medium">Paper</th>
                {columns.map((c) => (
                  <th key={c.label} className="pb-3 font-medium">
                    {c.label}
                    <span className="block text-xs font-normal text-slate-500">{c.unit}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shop.paper_sizes.map((paper) => (
                <tr key={paper} className="border-t border-slate-100">
                  <td className="py-3 font-medium">{paper}</td>
                  {columns.map((c) => {
                    const k = keyOf(paper, c.color, c.sides);
                    return (
                      <td key={k} className="py-3 pr-4">
                        <label className="flex h-10 w-32 items-center rounded-lg border border-slate-300 bg-white focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-line">
                          <span className="pl-3 text-slate-500">₹</span>
                          <input
                            inputMode="decimal"
                            aria-label={`${paper} ${c.label}`}
                            value={draft[k] ?? ''}
                            placeholder="—"
                            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                            className="h-full w-full bg-transparent px-2 tabular-nums outline-none"
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!shop.duplex_available && <p className="mt-4 text-sm text-slate-500">Both-sides printing is off. Turn it on in Settings to set those prices.</p>}
      </Card>
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
      <div className="flex justify-end">
        <Button variant="primary" disabled={busy || !saved} onClick={() => void save()}>
          {busy && <Spinner />} Save prices
        </Button>
      </div>
    </div>
  );
}
