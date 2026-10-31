import type { ColorMode, FilePrintOptions } from './pricing';

/**
 * How a shop prints orders that mix B&W and colour pages:
 * - `single_pass`: the whole file goes to the colour printer.
 * - `split`: B&W pages go to the B&W printer and colour pages to the colour
 *   printer, and the owner merges the sheets. Only used for single-sided,
 *   single-copy orders, where merging by hand is easy.
 */
export const MIXED_COLOR_MODES = ['single_pass', 'split'] as const;
export type MixedColorMode = (typeof MIXED_COLOR_MODES)[number];

export interface PrintPartPlan {
  kind: ColorMode;
  /** Source page numbers in print order. */
  pages: number[];
  /** True when a colour part also contains B&W pages. */
  mixed: boolean;
}

/** A print-ready PDF the processor built, as stored in `job_files.print_parts`. */
export interface PrintPart extends PrintPartPlan {
  path: string;
}

export function planPrintParts(
  options: Pick<FilePrintOptions, 'pageSequence' | 'colorPages' | 'copies' | 'sides'>,
  mode: MixedColorMode,
): PrintPartPlan[] {
  const color = new Set(options.colorPages);
  const seq = [...options.pageSequence];
  const colorPages = seq.filter((p) => color.has(p));

  if (colorPages.length === 0) return [{ kind: 'bw', pages: seq, mixed: false }];
  if (colorPages.length === seq.length) return [{ kind: 'color', pages: seq, mixed: false }];

  if (mode === 'split' && options.sides === 'single' && options.copies === 1) {
    return [
      { kind: 'bw', pages: seq.filter((p) => !color.has(p)), mixed: false },
      { kind: 'color', pages: colorPages, mixed: false },
    ];
  }
  return [{ kind: 'color', pages: seq, mixed: true }];
}
