/**
 * The customer's per-file choices as edited in the UI, and their conversion to the
 * FileSelection the pricing function and the submit API understand.
 */
import {
  allPages,
  parsePageRange,
  type FileSelection,
  type PaperSize,
  type RateRow,
  type Sides,
} from "@print/shared";

export type ColorChoice = "bw" | "color" | "mixed";

export interface FileOptions {
  /** "" = all pages; otherwise ranges like "1-5, 8" in print order. */
  range: string;
  color: ColorChoice;
  /** Only for color = "mixed": which pages are colour. */
  colorRange: string;
  copies: number;
  sides: Sides;
  paperSize: PaperSize;
}

export interface ShopOptions {
  paperSizes: PaperSize[];
  canBw: (sides: Sides, paper: PaperSize) => boolean;
  canColor: (sides: Sides, paper: PaperSize) => boolean;
  canDouble: (paper: PaperSize) => boolean;
}

export function shopOptions(rates: readonly RateRow[]): ShopOptions {
  const has = (paper: PaperSize, mode: RateRow["colorMode"], sides: Sides) =>
    rates.some((r) => r.paperSize === paper && r.colorMode === mode && r.sides === sides);
  const order: PaperSize[] = ["A4", "A3", "Legal"];
  return {
    paperSizes: order.filter((p) => rates.some((r) => r.paperSize === p)),
    canBw: (sides, paper) => has(paper, "bw", sides),
    canColor: (sides, paper) => has(paper, "color", sides),
    canDouble: (paper) => has(paper, "bw", "double") || has(paper, "color", "double"),
  };
}

export function defaultOptions(shop: ShopOptions): FileOptions {
  const paperSize = shop.paperSizes[0] ?? "A4";
  return {
    range: "",
    color: shop.canBw("single", paperSize) ? "bw" : "color",
    colorRange: "",
    copies: 1,
    sides: "single",
    paperSize,
  };
}

export type SelectionResult =
  | { ok: true; selection: FileSelection }
  | { ok: false; error: string; field: "range" | "colorRange" };

export function toSelection(opts: FileOptions, pageCount: number): SelectionResult {
  const range = parsePageRange(opts.range, pageCount);
  if (!range.ok) return { ok: false, error: range.error, field: "range" };

  let colorPages: number[] = [];
  if (opts.color === "color") {
    colorPages = allPages(pageCount);
  } else if (opts.color === "mixed") {
    if (opts.colorRange.trim() === "") {
      return { ok: false, error: "Type which pages are colour, e.g. 1, 4", field: "colorRange" };
    }
    const colour = parsePageRange(opts.colorRange, pageCount);
    if (!colour.ok) return { ok: false, error: colour.error, field: "colorRange" };
    colorPages = [...new Set(colour.pages)].sort((a, b) => a - b);
  }

  return {
    ok: true,
    selection: {
      pageSequence: range.pages,
      colorPages,
      copies: opts.copies,
      sides: opts.sides,
      paperSize: opts.paperSize,
    },
  };
}

/** One-line human summary, e.g. "Pages 1-3, 5 · B&W · 2 copies · double sided". */
export function describeSelection(
  sel: Pick<FileSelection, "pageSequence" | "colorPages" | "copies" | "sides">,
  pageCount: number | null,
  formatRange: (pages: readonly number[]) => string,
): string {
  const parts: string[] = [];
  const isAll =
    pageCount !== null &&
    sel.pageSequence.length === pageCount &&
    sel.pageSequence.every((p, i) => p === i + 1);
  if (isAll) parts.push(pageCount === 1 ? "1 page" : `All ${pageCount} pages`);
  else parts.push(`${sel.pageSequence.length === 1 ? "Page" : "Pages"} ${formatRange(sel.pageSequence)}`);
  const colorSet = new Set(sel.colorPages);
  const colourCount = sel.pageSequence.filter((p) => colorSet.has(p)).length;
  if (colourCount === 0) parts.push("B&W");
  else if (colourCount === sel.pageSequence.length) parts.push("Colour");
  else parts.push(`Colour pages ${formatRange([...new Set(sel.colorPages)])}, rest B&W`);
  parts.push(sel.copies === 1 ? "1 copy" : `${sel.copies} copies`);
  parts.push(sel.sides === "double" ? "double sided" : "single sided");
  return parts.join(" · ");
}
