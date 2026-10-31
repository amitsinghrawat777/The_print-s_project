import { MAX_SEQUENCE_LENGTH } from './constants';

export type PageRangeResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

/**
 * Parses what the customer typed into the print order, e.g. `1-5, 8, 10-12`.
 * Pages print in the order written, so `5-1` prints in reverse and `3, 1, 2`
 * prints page 3 first. An empty string (or "all") means every page in order.
 */
export function parsePageRange(input: string, pageCount: number): PageRangeResult {
  const text = input.trim().toLowerCase();
  if (text === '' || text === 'all') {
    return { ok: true, pages: allPages(pageCount) };
  }

  const pages: number[] = [];
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (part === '') continue;

    const match = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(part);
    if (!match) {
      return { ok: false, error: `"${raw.trim()}" is not a page or range. Use numbers like 1-5, 8` };
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);

    for (const n of [start, end]) {
      if (n < 1) return { ok: false, error: 'Page numbers start at 1' };
      if (n > pageCount) {
        return {
          ok: false,
          error: `Page ${n} doesn't exist. This file has ${pageCount} page${pageCount === 1 ? '' : 's'}`,
        };
      }
    }

    const step = end >= start ? 1 : -1;
    if (pages.length + Math.abs(end - start) + 1 > MAX_SEQUENCE_LENGTH) {
      return { ok: false, error: `You can print at most ${MAX_SEQUENCE_LENGTH} pages per copy` };
    }
    for (let n = start; n !== end + step; n += step) pages.push(n);
  }

  if (pages.length === 0) return { ok: false, error: 'Choose at least one page' };
  return { ok: true, pages };
}

/** Turns a page sequence back into short text: [1,2,3,5,4] → "1-3, 5, 4". */
export function formatPageRange(pages: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    const start = pages[i]!;
    let j = i;
    const step = pages[i + 1] === start + 1 ? 1 : pages[i + 1] === start - 1 ? -1 : 0;
    if (step !== 0) {
      while (pages[j + 1] === pages[j]! + step) j++;
    }
    const runLength = j - i + 1;
    if (runLength >= 3) {
      parts.push(`${start}-${pages[j]}`);
      i = j + 1;
    } else {
      parts.push(String(start));
      i += 1;
    }
  }
  return parts.join(', ');
}

export function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, k) => k + 1);
}

export function isAllPagesInOrder(pages: readonly number[], pageCount: number): boolean {
  return pages.length === pageCount && pages.every((p, k) => p === k + 1);
}
