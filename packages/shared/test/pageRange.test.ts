import { describe, expect, it } from "vitest";
import { formatPageRange, isValidSequence, parsePageRange } from "../src/pageRange.js";

describe("parsePageRange", () => {
  it("treats empty and 'all' as every page", () => {
    expect(parsePageRange("", 3)).toEqual({ ok: true, pages: [1, 2, 3] });
    expect(parsePageRange("  ALL ", 2)).toEqual({ ok: true, pages: [1, 2] });
  });

  it("parses singles and ranges in typed order", () => {
    expect(parsePageRange("1-3, 8, 10-12", 12)).toEqual({
      ok: true,
      pages: [1, 2, 3, 8, 10, 11, 12],
    });
  });

  it("supports reverse ranges and repeats", () => {
    expect(parsePageRange("5-3,1,1", 5)).toEqual({ ok: true, pages: [5, 4, 3, 1, 1] });
  });

  it("accepts en dashes, semicolons and extra spaces", () => {
    expect(parsePageRange(" 2 – 4 ; 6 ", 6)).toEqual({ ok: true, pages: [2, 3, 4, 6] });
  });

  it("rejects pages outside the document", () => {
    const r = parsePageRange("1-9", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Page 9 does not exist");
    expect(parsePageRange("0", 5).ok).toBe(false);
  });

  it("rejects garbage", () => {
    expect(parsePageRange("1-", 5).ok).toBe(false);
    expect(parsePageRange("abc", 5).ok).toBe(false);
    expect(parsePageRange("1.5", 5).ok).toBe(false);
    expect(parsePageRange(",,", 5).ok).toBe(false);
  });

  it("caps very long sequences", () => {
    expect(parsePageRange("1-500,1-500,1-500,1-500,1-500", 500).ok).toBe(false);
  });
});

describe("formatPageRange", () => {
  it("compresses runs in both directions", () => {
    expect(formatPageRange([1, 2, 3, 5, 4])).toBe("1-3, 5-4");
    expect(formatPageRange([1, 2, 3, 8, 10, 11, 12])).toBe("1-3, 8, 10-12");
    expect(formatPageRange([7])).toBe("7");
    expect(formatPageRange([])).toBe("");
  });

  it("round-trips through parsePageRange", () => {
    const pages = [3, 4, 5, 1, 9, 8, 7, 7];
    const r = parsePageRange(formatPageRange(pages), 9);
    expect(r).toEqual({ ok: true, pages });
  });
});

describe("isValidSequence", () => {
  it("checks bounds and integers", () => {
    expect(isValidSequence([1, 2], 2)).toBe(true);
    expect(isValidSequence([], 2)).toBe(false);
    expect(isValidSequence([3], 2)).toBe(false);
    expect(isValidSequence([1.5], 2)).toBe(false);
  });
});
