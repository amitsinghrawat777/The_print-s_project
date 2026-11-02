import { PAPER_SIZES, type ColorMode, type PaperSize, type Sides } from '@prints/shared';

// Same columns, units and rules as the desktop app's rate card
// (apps/desktop/src/renderer/src/components/RateCard.tsx).
export const RATE_COLUMNS: { color: ColorMode; sides: Sides; label: string; unit: string }[] = [
  { color: 'bw', sides: 'single', label: 'B&W, one side', unit: 'per page' },
  { color: 'color', sides: 'single', label: 'Colour, one side', unit: 'per page' },
  { color: 'bw', sides: 'double', label: 'B&W, both sides', unit: 'per sheet' },
  { color: 'color', sides: 'double', label: 'Colour, both sides', unit: 'per sheet' },
];

export const keyOf = (paper: string, color: string, sides: string) => `${paper}|${color}|${sides}`;

/** "2", "2.5", "" → paise, or null for "not offered". Throws on nonsense. */
export function toPaise(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) throw new Error(`"${text}" is not a price`);
  const paise = Math.round(Number(t) * 100);
  if (paise > 100000) throw new Error('Prices must be ₹1,000 or less');
  return paise;
}

export const toText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

// Typical prices in rupees (B&W page, colour page, B&W sheet, colour sheet). A3 is double.
const TYPICAL: Record<PaperSize, [number, number, number, number]> = {
  A4: [2, 10, 3, 18],
  A3: [4, 20, 6, 36],
  Legal: [3, 12, 5, 22],
  Letter: [2, 10, 3, 18],
};

/** A filled-in rate card the owner only has to adjust. */
export function defaultDraft(): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const paper of PAPER_SIZES) {
    RATE_COLUMNS.forEach((c, i) => (draft[keyOf(paper, c.color, c.sides)] = String(TYPICAL[paper][i])));
  }
  return draft;
}

export interface RateRow {
  shop_id: string;
  paper_size: PaperSize;
  color_mode: ColorMode;
  sides: Sides;
  price_paise: number;
}

/**
 * The shop_rates rows for the chosen papers. Both-sides prices are only saved
 * when the shop can print both sides. Every paper needs at least one price,
 * or customers couldn't order on it. Throws a message for the owner.
 */
export function buildRateRows(
  shopId: string,
  papers: readonly PaperSize[],
  duplex: boolean,
  draft: Record<string, string>,
): RateRow[] {
  const rows: RateRow[] = [];
  for (const paper of papers) {
    let count = 0;
    for (const c of RATE_COLUMNS) {
      if (c.sides === 'double' && !duplex) continue;
      let paise: number | null;
      try {
        paise = toPaise(draft[keyOf(paper, c.color, c.sides)] ?? '');
      } catch (e) {
        throw new Error(`${paper}, ${c.label}: ${(e as Error).message}`);
      }
      if (paise === null) continue;
      rows.push({ shop_id: shopId, paper_size: paper, color_mode: c.color, sides: c.sides, price_paise: paise });
      count++;
    }
    if (count === 0) throw new Error(`Add at least one price for ${paper}, or untick it.`);
  }
  return rows;
}
