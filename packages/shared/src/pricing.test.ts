import { describe, expect, it } from 'vitest';
import {
  availableOptions,
  formatPaise,
  priceFile,
  priceJob,
  PricingError,
  type FilePrintOptions,
  type RateCard,
} from './pricing';

// ₹2 B&W page, ₹10 colour page, ₹3 B&W sheet (double), ₹18 colour sheet (double)
const rates: RateCard = [
  { paperSize: 'A4', colorMode: 'bw', sides: 'single', pricePaise: 200 },
  { paperSize: 'A4', colorMode: 'color', sides: 'single', pricePaise: 1000 },
  { paperSize: 'A4', colorMode: 'bw', sides: 'double', pricePaise: 300 },
  { paperSize: 'A4', colorMode: 'color', sides: 'double', pricePaise: 1800 },
];

const opts = (o: Partial<FilePrintOptions>): FilePrintOptions => ({
  pageSequence: [1, 2, 3],
  colorPages: [],
  copies: 1,
  sides: 'single',
  paperSize: 'A4',
  ...o,
});

describe('priceFile', () => {
  it('charges B&W single-sided per page', () => {
    const p = priceFile(opts({ pageSequence: [1, 2, 3] }), rates);
    expect(p).toMatchObject({ bwPages: 3, colorPages: 0, sheets: 3, perCopyPaise: 600, pricePaise: 600 });
  });

  it('multiplies by copies', () => {
    expect(priceFile(opts({ copies: 2 }), rates).pricePaise).toBe(1200);
  });

  it('charges colour pages at the colour rate in a mixed file', () => {
    // 10 pages, pages 1 and 4 colour → 8×2 + 2×10 = 36
    const seq = Array.from({ length: 10 }, (_, i) => i + 1);
    const p = priceFile(opts({ pageSequence: seq, colorPages: [1, 4] }), rates);
    expect(p).toMatchObject({ bwPages: 8, colorPages: 2, pricePaise: 3600 });
  });

  it('ignores colour pages that are not being printed', () => {
    const p = priceFile(opts({ pageSequence: [1, 2], colorPages: [5] }), rates);
    expect(p.colorPages).toBe(0);
    expect(p.pricePaise).toBe(400);
  });

  it('counts repeated pages each time they print', () => {
    const p = priceFile(opts({ pageSequence: [1, 1, 1], colorPages: [1] }), rates);
    expect(p.colorPages).toBe(3);
    expect(p.pricePaise).toBe(3000);
  });

  it('charges double-sided per sheet', () => {
    // 4 pages → 2 sheets × ₹3
    const p = priceFile(opts({ pageSequence: [1, 2, 3, 4], sides: 'double' }), rates);
    expect(p).toMatchObject({ sheets: 2, pricePaise: 600 });
  });

  it('charges a lone last side at the single-sided rate', () => {
    // 5 pages → 2 full sheets (₹3 each) + 1 one-sided page (₹2)
    const p = priceFile(opts({ pageSequence: [1, 2, 3, 4, 5], sides: 'double' }), rates);
    expect(p).toMatchObject({ sheets: 3, pricePaise: 800 });
  });

  it('charges a double-sided sheet as colour if either side is colour', () => {
    // sheets: [1,2] colour (2 is colour) ₹18, [3,4] B&W ₹3, [5] colour single ₹10
    const p = priceFile(
      opts({ pageSequence: [1, 2, 3, 4, 5], colorPages: [2, 5], sides: 'double' }),
      rates,
    );
    expect(p.pricePaise).toBe(1800 + 300 + 1000);
  });

  it('pairs sheets in print order, not page-number order', () => {
    // print order 1,3,2,4 with page 3 colour → sheets [1,3] colour, [2,4] B&W
    const p = priceFile(
      opts({ pageSequence: [1, 3, 2, 4], colorPages: [3], sides: 'double' }),
      rates,
    );
    expect(p.pricePaise).toBe(1800 + 300);
  });

  it('throws when the shop has no rate for the option', () => {
    const bwOnly: RateCard = [rates[0]!];
    expect(() => priceFile(opts({ colorPages: [1] }), bwOnly)).toThrow(PricingError);
    expect(() => priceFile(opts({ sides: 'double' }), bwOnly)).toThrow(/double-sided/);
  });

  it('does not need a colour rate for an all-B&W order', () => {
    const bwOnly: RateCard = [rates[0]!];
    expect(priceFile(opts({}), bwOnly).pricePaise).toBe(600);
  });

  it('rejects empty selections and bad copies', () => {
    expect(() => priceFile(opts({ pageSequence: [] }), rates)).toThrow(/at least one page/);
    expect(() => priceFile(opts({ copies: 0 }), rates)).toThrow(/Copies/);
  });
});

describe('priceJob', () => {
  it('adds up files (the example from MVP_PLAN.md)', () => {
    // Resume.pdf: 3 B&W × 2 copies = ₹12; Project.docx: 10 B&W + 2 colour = ₹40
    const project = Array.from({ length: 12 }, (_, i) => i + 1);
    const price = priceJob(
      [opts({ pageSequence: [1, 2, 3], copies: 2 }), opts({ pageSequence: project, colorPages: [1, 12] })],
      rates,
    );
    expect(price.files.map((f) => f.pricePaise)).toEqual([1200, 4000]);
    expect(price).toMatchObject({ subtotalPaise: 5200, roundingPaise: 0, totalPaise: 5200 });
  });

  it('rounds the total to the nearest rupee', () => {
    const halfRupee: RateCard = [{ paperSize: 'A4', colorMode: 'bw', sides: 'single', pricePaise: 150 }];
    // 3 × ₹1.50 = ₹4.50 → ₹5
    expect(priceJob([opts({})], halfRupee)).toMatchObject({
      subtotalPaise: 450,
      roundingPaise: 50,
      totalPaise: 500,
    });
    const quarter: RateCard = [{ paperSize: 'A4', colorMode: 'bw', sides: 'single', pricePaise: 125 }];
    // 3 × ₹1.25 = ₹3.75 → ₹4; 1 × ₹1.25 → ₹1
    expect(priceJob([opts({})], quarter).totalPaise).toBe(400);
    expect(priceJob([opts({ pageSequence: [1] })], quarter)).toMatchObject({ roundingPaise: -25, totalPaise: 100 });
  });
});

describe('availableOptions', () => {
  it('reflects the rate card and duplex support', () => {
    expect(availableOptions(rates, 'A4', true)).toEqual({ bw: true, color: true, double: true, doubleColor: true });
    expect(availableOptions(rates, 'A4', false)).toMatchObject({ double: false, doubleColor: false });
    expect(availableOptions(rates, 'A3', true)).toEqual({ bw: false, color: false, double: false, doubleColor: false });
  });
});

describe('formatPaise', () => {
  it('shows whole rupees without decimals', () => {
    expect(formatPaise(5200)).toBe('₹52');
    expect(formatPaise(450)).toBe('₹4.50');
    expect(formatPaise(125000)).toBe('₹1,250');
  });
});
