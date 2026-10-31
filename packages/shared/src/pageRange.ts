/**
 * Page-range parsing for customer input such as "1-5, 8, 10-12".
 *
 * - Pages are 1-based.
 * - The order typed is the order printed, so "5-1" prints pages 5,4,3,2,1.
 * - Repeating a page is allowed ("1, 1") and prints it twice.
 * - An empty string or "all" means every page in document order.
 */

export const MAX_SEQUENCE_LENGTH = 2000;

export type PageRangeResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

const DASHES = /[‐-―−]/g; // hyphen/en/em dash variants, minus sign

export function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, i) => i + 1);
}

export function parsePageRange(input: string, pageCount: number): PageRangeResult {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: "Document has no pages" };
  }

  const text = input.trim().toLowerCase().replace(DASHES, "-");
  if (text === "" || text === "all") {
    return { ok: true, pages: allPages(pageCount) };
  }

  const pages: number[] = [];
  const parts = text.split(/[,;]/).map((p) => p.trim());

  for (const part of parts) {
    if (part === "") continue;

    const single = /^(\d+)$/.exec(part);
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);

    if (single) {
      const n = Number(single[1]);
      const err = checkPage(n, pageCount);
      if (err) return { ok: false, error: err };
      pages.push(n);
    } else if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const err = checkPage(from, pageCount) ?? checkPage(to, pageCount);
      if (err) return { ok: false, error: err };
      const step = from <= to ? 1 : -1;
      for (let n = from; n !== to + step; n += step) {
        pages.push(n);
        if (pages.length > MAX_SEQUENCE_LENGTH) {
          return { ok: false, error: `Too many pages (max ${MAX_SEQUENCE_LENGTH})` };
        }
      }
    } else {
      return { ok: false, error: `"${part}" is not a page or range (use e.g. 1-5, 8)` };
    }

    if (pages.length > MAX_SEQUENCE_LENGTH) {
      return { ok: false, error: `Too many pages (max ${MAX_SEQUENCE_LENGTH})` };
    }
  }

  if (pages.length === 0) {
    return { ok: false, error: "Select at least one page" };
  }
  return { ok: true, pages };
}

function checkPage(n: number, pageCount: number): string | undefined {
  if (n < 1) return "Pages start at 1";
  if (n > pageCount) {
    return `Page ${n} does not exist (document has ${pageCount} page${pageCount === 1 ? "" : "s"})`;
  }
  return undefined;
}

/**
 * Turns a page sequence back into compact text: [1,2,3,5,4] -> "1-3, 5, 4".
 * Runs are compressed in both directions (ascending and descending).
 */
export function formatPageRange(pages: readonly number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < pages.length) {
    const start = pages[i]!;
    let j = i;
    const step = pages[i + 1] !== undefined ? pages[i + 1]! - start : 0;
    if (step === 1 || step === -1) {
      while (j + 1 < pages.length && pages[j + 1]! - pages[j]! === step) j++;
    }
    out.push(j > i ? `${start}-${pages[j]}` : `${start}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** True when every page in the sequence exists in a document of `pageCount` pages. */
export function isValidSequence(pages: readonly number[], pageCount: number): boolean {
  return (
    pages.length > 0 &&
    pages.length <= MAX_SEQUENCE_LENGTH &&
    pages.every((p) => Number.isInteger(p) && p >= 1 && p <= pageCount)
  );
}
