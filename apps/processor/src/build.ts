/**
 * Builds print-ready PDFs from a normalized PDF and the customer's choices:
 * only the selected pages, in the chosen order, split by colour mode.
 * See ARCHITECTURE.md §8 "Mixed colour orders".
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import type { Sides } from "@print/shared";

const execFileAsync = promisify(execFile);

export type PrintMode = "split" | "single_pass";

export interface BuildSelection {
  pageSequence: readonly number[];
  colorPages: readonly number[];
  copies: number;
  sides: Sides;
}

export interface PrintPart {
  bytes: Uint8Array;
  pages: number;
}

export interface BuildResult {
  mode: PrintMode;
  /** Goes to the B&W printer. */
  bw: PrintPart | null;
  /** Goes to the colour printer. In single_pass mode this holds every page. */
  color: PrintPart | null;
  /** True when single_pass B&W pages could not be converted to greyscale. */
  greyscaleSkipped: boolean;
}

/**
 * Split (two files) only works when sheet order and collation don't matter:
 * single sided and one copy. Otherwise a mixed job prints in one pass on the
 * colour printer so pages stay in order.
 */
export function choosePrintMode(sel: BuildSelection, shopMode: PrintMode): PrintMode | "bw_only" | "color_only" {
  const colorSet = new Set(sel.colorPages);
  const hasColor = sel.pageSequence.some((p) => colorSet.has(p));
  const hasBw = sel.pageSequence.some((p) => !colorSet.has(p));
  if (!hasColor) return "bw_only";
  if (!hasBw) return "color_only";
  if (shopMode === "split" && sel.sides === "single" && sel.copies === 1) return "split";
  return "single_pass";
}

/** Copies pages (1-based, any order, repeats allowed) from one or two sources into a new PDF. */
async function assemble(
  pages: readonly { source: PDFDocument; page: number }[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const { source, page } of pages) {
    const [copied] = await out.copyPages(source, [page - 1]);
    out.addPage(copied!);
  }
  return out.save();
}

export type GreyscaleFn = (pdf: Uint8Array) => Promise<Uint8Array | null>;

export async function buildPrintFiles(
  pdf: Uint8Array,
  sel: BuildSelection,
  shopMode: PrintMode,
  greyscale: GreyscaleFn,
): Promise<BuildResult> {
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  const pageCount = source.getPageCount();
  for (const p of sel.pageSequence) {
    if (!Number.isInteger(p) || p < 1 || p > pageCount) {
      throw new Error(`Page ${p} out of range (1-${pageCount})`);
    }
  }

  const colorSet = new Set(sel.colorPages);
  const choice = choosePrintMode(sel, shopMode);
  const all = sel.pageSequence.map((page) => ({ source, page }));

  if (choice === "bw_only") {
    return {
      mode: "split",
      bw: { bytes: await assemble(all), pages: all.length },
      color: null,
      greyscaleSkipped: false,
    };
  }
  if (choice === "color_only") {
    return {
      mode: "split",
      bw: null,
      color: { bytes: await assemble(all), pages: all.length },
      greyscaleSkipped: false,
    };
  }
  if (choice === "split") {
    const bwPages = all.filter((x) => !colorSet.has(x.page));
    const colorPages = all.filter((x) => colorSet.has(x.page));
    return {
      mode: "split",
      bw: { bytes: await assemble(bwPages), pages: bwPages.length },
      color: { bytes: await assemble(colorPages), pages: colorPages.length },
      greyscaleSkipped: false,
    };
  }

  // single_pass: every page in order; B&W pages taken from a greyscale copy.
  const greyBytes = await greyscale(pdf);
  const grey = greyBytes ? await PDFDocument.load(greyBytes, { updateMetadata: false }) : null;
  if (grey && grey.getPageCount() !== pageCount) {
    throw new Error("Greyscale copy has a different page count");
  }
  const mixed = sel.pageSequence.map((page) => ({
    source: colorSet.has(page) || !grey ? source : grey,
    page,
  }));
  return {
    mode: "single_pass",
    bw: null,
    color: { bytes: await assemble(mixed), pages: mixed.length },
    greyscaleSkipped: grey === null,
  };
}

/** Ghostscript greyscale conversion; returns null if Ghostscript is missing or fails. */
export function ghostscriptGreyscale(gsBin: string, timeoutMs = 60_000): GreyscaleFn {
  return async (pdf) => {
    const dir = await mkdtemp(join(tmpdir(), "print-gs-"));
    try {
      const input = join(dir, "in.pdf");
      const output = join(dir, "out.pdf");
      await writeFile(input, pdf, { mode: 0o600 });
      await execFileAsync(
        gsBin,
        [
          "-q",
          "-dSAFER",
          "-dBATCH",
          "-dNOPAUSE",
          "-sDEVICE=pdfwrite",
          "-sColorConversionStrategy=Gray",
          "-sProcessColorModel=DeviceGray",
          "-dOverrideICC",
          `-sOutputFile=${output}`,
          input,
        ],
        { timeout: timeoutMs },
      );
      return new Uint8Array(await readFile(output));
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
