import type { PrintPaper } from '../ipc';

export interface PrintOptions {
  printer: string;
  copies: number;
  duplex: boolean;
  color: boolean;
  paperSize: PrintPaper;
}

/**
 * SumatraPDF command line (Windows). The PDF already holds exactly the pages to
 * print in order, so no page range is passed. `shrink` keeps true size and only
 * scales pages that are bigger than the paper.
 * https://www.sumatrapdfreader.org/docs/Command-line-arguments
 */
export function sumatraArgs(file: string, o: PrintOptions): string[] {
  const settings = [
    `${o.copies}x`,
    o.duplex ? 'duplexlong' : 'simplex',
    o.color ? 'color' : 'monochrome',
    `paper=${o.paperSize}`,
    'shrink',
  ].join(',');
  return ['-print-to', o.printer, '-print-settings', settings, '-silent', '-exit-when-done', file];
}

/** CUPS `lp` command line (macOS). */
export function lpArgs(file: string, o: PrintOptions): string[] {
  return [
    '-d', o.printer,
    '-n', String(o.copies),
    '-o', `sides=${o.duplex ? 'two-sided-long-edge' : 'one-sided'}`,
    '-o', `media=${o.paperSize}`,
    '-o', `print-color-mode=${o.color ? 'color' : 'monochrome'}`,
    '-o', 'collate=true',
    '--', file,
  ];
}

/** Turns a label into something safe for a file name. */
export function safeFileName(label: string): string {
  return label.replace(/[^\w.#&() -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'print';
}
