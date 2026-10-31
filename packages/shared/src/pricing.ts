export const COLOR_MODES = ['bw', 'color'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const SIDES = ['single', 'double'] as const;
export type Sides = (typeof SIDES)[number];

export const PAPER_SIZES = ['A4', 'A3', 'Legal', 'Letter'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

/**
 * One line of a shop's rate card. Single-sided rates are per page; double-sided
 * rates are per sheet (two printed sides).
 */
export interface Rate {
  paperSize: PaperSize;
  colorMode: ColorMode;
  sides: Sides;
  pricePaise: number;
}
export type RateCard = readonly Rate[];

export interface FilePrintOptions {
  /** 1-based page numbers in the order they print. Repeats are allowed. */
  pageSequence: readonly number[];
  /** Page numbers that print in colour. Every other page prints B&W. */
  colorPages: readonly number[];
  copies: number;
  sides: Sides;
  paperSize: PaperSize;
}

export interface FilePrice {
  /** Pages per copy. */
  bwPages: number;
  colorPages: number;
  /** Sheets of paper per copy. */
  sheets: number;
  copies: number;
  perCopyPaise: number;
  /** Price for all copies of this file. */
  pricePaise: number;
}

export interface JobPrice {
  files: FilePrice[];
  subtotalPaise: number;
  /** Added so the total is a whole number of rupees (can be negative). */
  roundingPaise: number;
  totalPaise: number;
}

export class PricingError extends Error {
  constructor(
    readonly code: 'RATE_MISSING' | 'INVALID_OPTIONS',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

export function findRate(
  rates: RateCard,
  paperSize: PaperSize,
  colorMode: ColorMode,
  sides: Sides,
): number | null {
  const rate = rates.find(
    (r) => r.paperSize === paperSize && r.colorMode === colorMode && r.sides === sides,
  );
  return rate ? rate.pricePaise : null;
}

function requireRate(rates: RateCard, paperSize: PaperSize, colorMode: ColorMode, sides: Sides): number {
  const price = findRate(rates, paperSize, colorMode, sides);
  if (price === null) {
    const label = `${paperSize} ${colorMode === 'bw' ? 'B&W' : 'colour'} ${sides}-sided`;
    throw new PricingError('RATE_MISSING', `This shop doesn't offer ${label} printing`);
  }
  return price;
}

/**
 * Price of one file.
 *
 * Single-sided: every page is charged at its B&W or colour per-page rate.
 * Double-sided: pages are paired into sheets in print order. A sheet with any
 * colour page uses the colour per-sheet rate, otherwise the B&W per-sheet rate.
 * A last sheet with only one printed side is charged like a single-sided page.
 */
export function priceFile(options: FilePrintOptions, rates: RateCard): FilePrice {
  const { pageSequence, copies, sides, paperSize } = options;
  if (pageSequence.length === 0) {
    throw new PricingError('INVALID_OPTIONS', 'Choose at least one page');
  }
  if (!Number.isInteger(copies) || copies < 1) {
    throw new PricingError('INVALID_OPTIONS', 'Copies must be at least 1');
  }

  const color = new Set(options.colorPages);
  const isColor = (page: number) => color.has(page);
  const colorPages = pageSequence.filter(isColor).length;
  const bwPages = pageSequence.length - colorPages;

  let perCopyPaise = 0;
  let sheets = 0;
  if (sides === 'single') {
    if (bwPages > 0) perCopyPaise += bwPages * requireRate(rates, paperSize, 'bw', 'single');
    if (colorPages > 0) perCopyPaise += colorPages * requireRate(rates, paperSize, 'color', 'single');
    sheets = pageSequence.length;
  } else {
    for (let i = 0; i < pageSequence.length; i += 2) {
      const front = pageSequence[i]!;
      const back = pageSequence[i + 1];
      sheets += 1;
      if (back === undefined) {
        perCopyPaise += requireRate(rates, paperSize, isColor(front) ? 'color' : 'bw', 'single');
      } else {
        const mode: ColorMode = isColor(front) || isColor(back) ? 'color' : 'bw';
        perCopyPaise += requireRate(rates, paperSize, mode, 'double');
      }
    }
  }

  return {
    bwPages,
    colorPages,
    sheets,
    copies,
    perCopyPaise,
    pricePaise: perCopyPaise * copies,
  };
}

/** Price of a whole order. The total is rounded to the nearest rupee. */
export function priceJob(files: readonly FilePrintOptions[], rates: RateCard): JobPrice {
  const priced = files.map((f) => priceFile(f, rates));
  const subtotalPaise = priced.reduce((sum, f) => sum + f.pricePaise, 0);
  const totalPaise = Math.round(subtotalPaise / 100) * 100;
  return {
    files: priced,
    subtotalPaise,
    roundingPaise: totalPaise - subtotalPaise,
    totalPaise,
  };
}

/** Which options a shop's rate card allows, for building the order form. */
export function availableOptions(rates: RateCard, paperSize: PaperSize, duplexAvailable: boolean) {
  return {
    bw: findRate(rates, paperSize, 'bw', 'single') !== null,
    color: findRate(rates, paperSize, 'color', 'single') !== null,
    double:
      duplexAvailable &&
      findRate(rates, paperSize, 'bw', 'double') !== null,
    doubleColor:
      duplexAvailable &&
      findRate(rates, paperSize, 'color', 'double') !== null,
  };
}

/** ₹52, ₹4.50, ₹1,250 */
export function formatPaise(paise: number): string {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
