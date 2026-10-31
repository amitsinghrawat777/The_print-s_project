import { describe, expect, it } from 'vitest';
import { formatPageRange, isAllPagesInOrder, parsePageRange } from './pageRange';

const pages = (input: string, count = 20) => {
  const r = parsePageRange(input, count);
  if (!r.ok) throw new Error(r.error);
  return r.pages;
};
const error = (input: string, count = 20) => {
  const r = parsePageRange(input, count);
  if (r.ok) throw new Error(`expected an error for "${input}"`);
  return r.error;
};

describe('parsePageRange', () => {
  it('treats empty and "all" as every page', () => {
    expect(pages('', 3)).toEqual([1, 2, 3]);
    expect(pages('  All ', 3)).toEqual([1, 2, 3]);
  });

  it('parses lists and ranges in the order typed', () => {
    expect(pages('1-5, 8, 10-12')).toEqual([1, 2, 3, 4, 5, 8, 10, 11, 12]);
    expect(pages('3, 1, 2')).toEqual([3, 1, 2]);
  });

  it('prints a backwards range in reverse', () => {
    expect(pages('5-1')).toEqual([5, 4, 3, 2, 1]);
  });

  it('accepts spaces, semicolons, en dashes and trailing commas', () => {
    expect(pages(' 1 - 3 ; 7–8 ,')).toEqual([1, 2, 3, 7, 8]);
  });

  it('keeps repeated pages', () => {
    expect(pages('1, 1, 2-3, 2')).toEqual([1, 1, 2, 3, 2]);
  });

  it('rejects pages outside the document', () => {
    expect(error('1-25', 20)).toMatch(/Page 25 doesn't exist. This file has 20 pages/);
    expect(error('2', 1)).toMatch(/has 1 page$/);
    expect(error('0-3')).toMatch(/start at 1/);
  });

  it('rejects text that is not a page list', () => {
    expect(error('abc')).toMatch(/"abc" is not a page/);
    expect(error('1-2-3')).toMatch(/not a page/);
    expect(error('-3')).toMatch(/not a page/);
    expect(error(',,')).toMatch(/at least one page/);
  });

  it('caps very long sequences', () => {
    expect(error('1-500, 1-500, 1', 500)).toMatch(/at most 1000/);
  });
});

describe('formatPageRange', () => {
  it('compresses runs of three or more', () => {
    expect(formatPageRange([1, 2, 3, 4, 5, 8, 10, 11, 12])).toBe('1-5, 8, 10-12');
    expect(formatPageRange([1, 2, 4])).toBe('1, 2, 4');
    expect(formatPageRange([5, 4, 3, 2, 1])).toBe('5-1');
    expect(formatPageRange([1, 2, 3, 5, 4])).toBe('1-3, 5, 4');
    expect(formatPageRange([])).toBe('');
  });

  it('round-trips through parsePageRange', () => {
    const cases = [[1], [3, 1, 2], [1, 2, 3, 2, 1], [7, 7, 7], [10, 9, 8, 1, 2, 3, 5]];
    for (const seq of cases) expect(pages(formatPageRange(seq))).toEqual(seq);
  });
});

describe('isAllPagesInOrder', () => {
  it('detects the default selection', () => {
    expect(isAllPagesInOrder([1, 2, 3], 3)).toBe(true);
    expect(isAllPagesInOrder([1, 3, 2], 3)).toBe(false);
    expect(isAllPagesInOrder([1, 2], 3)).toBe(false);
  });
});
