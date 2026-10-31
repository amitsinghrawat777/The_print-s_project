/**
 * The single pricing function used by the web app (live preview), the API (final price)
 * and the desktop app (display). Pure and deterministic: same input -> same paise.
 *
 * Rules
 * - Single sided: every printed page costs the per-page rate for its colour mode.
 * - Double sided: pages are paired into sheets in print order. A sheet with any colour
 *   page costs the colour double-sided rate, otherwise the B&W double-sided rate.
 *   A leftover single page at the end costs the single-sided rate for its mode.
 * - Everything is multiplied by copies.
 * - The job total is rounded to the nearest rupee; line items are not rounded.
 */
import { roundToRupee } from "./money.js";
import type { ColorMode, PaperSize, Sides } from "./types.js";

export interface RateRow {
  paperSize: PaperSize;
  colorMode: ColorMode;
  sides: Sides;
  /** Per page for single sided, per sheet for double sided. */
  pricePaise: number;
}

export interface FileSelection {
  /** Page numbers (1-based) in the order they print. */
  pageSequence: readonly number[];
  /** Document page numbers that print in colour. Pages not listed print B&W. */
  colorPages: readonly number[];
  copies: number;
  sides: Sides;
  paperSize: PaperSize;
}

export interface FilePrice {
  bwPages: number;
  colorPages: number;
  /** Physical sheets per copy. */
  sheets: number;
  /** Price of one copy. */
  perCopyPaise: number;
  copies: number;
  totalPaise: number;
}

export interface JobPrice {
  files: FilePrice[];
  subtotalPaise: number;
  /** Rounded to the nearest rupee; this is what the customer pays. */
  totalPaise: number;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export const MAX_COPIES = 100;

export function findRate(
  rates: readonly RateRow[],
  paperSize: PaperSize,
  colorMode: ColorMode,
  sides: Sides,
): number {
  const row = rates.find(
    (r) => r.paperSize === paperSize && r.colorMode === colorMode && r.sides === sides,
  );
  if (!row) {
    const mode = colorMode === "bw" ? "B&W" : "colour";
    throw new PricingError(`This shop doesn't offer ${mode} ${sides}-sided ${paperSize} printing`);
  }
  return row.pricePaise;
}

/** Which colour modes and sides a shop's rate card supports, for building the UI. */
export function availableOptions(rates: readonly RateRow[]) {
  const has = (paperSize: PaperSize, colorMode: ColorMode, sides: Sides) =>
    rates.some((r) => r.paperSize === paperSize && r.colorMode === colorMode && r.sides === sides);
  const paperSizes = [...new Set(rates.map((r) => r.paperSize))];
  return { paperSizes, has };
}

export function priceFile(sel: FileSelection, rates: readonly RateRow[]): FilePrice {
  if (sel.pageSequence.length === 0) throw new PricingError("Select at least one page");
  if (!Number.isInteger(sel.copies) || sel.copies < 1 || sel.copies > MAX_COPIES) {
    throw new PricingError(`Copies must be between 1 and ${MAX_COPIES}`);
  }

  const colorSet = new Set(sel.colorPages);
  const isColor = sel.pageSequence.map((p) => colorSet.has(p));
  const colorPages = isColor.filter(Boolean).length;
  const bwPages = isColor.length - colorPages;

  let perCopyPaise = 0;
  let sheets = 0;

  if (sel.sides === "single") {
    if (bwPages > 0) perCopyPaise += bwPages * findRate(rates, sel.paperSize, "bw", "single");
    if (colorPages > 0) {
      perCopyPaise += colorPages * findRate(rates, sel.paperSize, "color", "single");
    }
    sheets = isColor.length;
  } else {
    for (let i = 0; i < isColor.length; i += 2) {
      sheets++;
      const front = isColor[i]!;
      const back = isColor[i + 1];
      if (back === undefined) {
        perCopyPaise += findRate(rates, sel.paperSize, front ? "color" : "bw", "single");
      } else {
        const mode: ColorMode = front || back ? "color" : "bw";
        perCopyPaise += findRate(rates, sel.paperSize, mode, "double");
      }
    }
  }

  return {
    bwPages,
    colorPages,
    sheets,
    perCopyPaise,
    copies: sel.copies,
    totalPaise: perCopyPaise * sel.copies,
  };
}

export function priceJob(files: readonly FileSelection[], rates: readonly RateRow[]): JobPrice {
  if (files.length === 0) throw new PricingError("Add at least one file");
  const priced = files.map((f) => priceFile(f, rates));
  const subtotalPaise = priced.reduce((sum, f) => sum + f.totalPaise, 0);
  return { files: priced, subtotalPaise, totalPaise: roundToRupee(subtotalPaise) };
}
