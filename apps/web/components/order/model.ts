import {
  allPages,
  availableOptions,
  type FilePrintOptions,
  type PaperSize,
  type Sides,
} from '@prints/shared';
import type { PublicShop } from '@/lib/types';

export type ColorChoice = 'bw' | 'color' | 'mixed';

/** What the customer picked for one file. */
export interface FileChoices {
  /** What's typed in the pages box. Empty means all pages. */
  rangeText: string;
  rangeError: string | null;
  /** The last valid page sequence (print order). */
  pageSequence: number[];
  colorChoice: ColorChoice;
  /** Pages marked colour in "mixed" mode, kept while switching modes. */
  mixedColorPages: number[];
  copies: number;
  sides: Sides;
  paperSize: PaperSize;
}

export type FilePhase = 'uploading' | 'processing' | 'ready' | 'rejected';

export interface OrderFile {
  /** Local id, stable from the moment the file is picked. */
  key: string;
  serverId: string | null;
  name: string;
  size: number;
  /** The customer's own file, used to show PDFs without downloading them again. */
  local: File | null;
  phase: FilePhase;
  progress: number;
  error: string | null;
  pageCount: number | null;
  previewUrl: string | null;
  choices: FileChoices;
}

export function defaultChoices(shop: PublicShop): FileChoices {
  const paperSize = shop.paperSizes[0] ?? 'A4';
  const options = availableOptions(shop.rates, paperSize, shop.duplexAvailable);
  return {
    rangeText: '',
    rangeError: null,
    pageSequence: [],
    colorChoice: options.bw ? 'bw' : 'color',
    mixedColorPages: [],
    copies: 1,
    sides: 'single',
    paperSize,
  };
}

/** Page numbers that print in colour for the current choice. */
export function colorPagesOf(file: OrderFile): number[] {
  const { colorChoice, mixedColorPages } = file.choices;
  if (colorChoice === 'bw') return [];
  if (colorChoice === 'color') return allPages(file.pageCount ?? 0);
  return mixedColorPages;
}

export function toPrintOptions(file: OrderFile): FilePrintOptions {
  return {
    pageSequence: file.choices.pageSequence,
    colorPages: colorPagesOf(file),
    copies: file.choices.copies,
    sides: file.choices.sides,
    paperSize: file.choices.paperSize,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
