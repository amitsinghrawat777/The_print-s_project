import { describe, expect, it } from "vitest";
import { formatPageRange, type RateRow } from "@print/shared";
import { defaultOptions, describeSelection, shopOptions, toSelection } from "./order";

const rates: RateRow[] = [
  { paperSize: "A4", colorMode: "bw", sides: "single", pricePaise: 200 },
  { paperSize: "A4", colorMode: "color", sides: "single", pricePaise: 1000 },
];

describe("shopOptions", () => {
  it("reports what the rate card allows", () => {
    const o = shopOptions(rates);
    expect(o.paperSizes).toEqual(["A4"]);
    expect(o.canBw("single", "A4")).toBe(true);
    expect(o.canDouble("A4")).toBe(false);
  });
});

describe("toSelection", () => {
  const base = defaultOptions(shopOptions(rates));

  it("defaults to all pages, B&W, one copy", () => {
    expect(toSelection(base, 3)).toEqual({
      ok: true,
      selection: { pageSequence: [1, 2, 3], colorPages: [], copies: 1, sides: "single", paperSize: "A4" },
    });
  });

  it("marks every page colour for colour mode", () => {
    const r = toSelection({ ...base, color: "color", range: "2-3" }, 3);
    expect(r.ok && r.selection.colorPages).toEqual([1, 2, 3]);
  });

  it("parses mixed colour pages", () => {
    const r = toSelection({ ...base, color: "mixed", colorRange: "4, 1, 1" }, 5);
    expect(r.ok && r.selection.colorPages).toEqual([1, 4]);
  });

  it("reports which field is wrong", () => {
    expect(toSelection({ ...base, range: "9" }, 3)).toMatchObject({ ok: false, field: "range" });
    expect(toSelection({ ...base, color: "mixed" }, 3)).toMatchObject({ ok: false, field: "colorRange" });
  });
});

describe("describeSelection", () => {
  it("summarises choices", () => {
    expect(
      describeSelection(
        { pageSequence: [1, 2, 3], colorPages: [], copies: 1, sides: "single" },
        3,
        formatPageRange,
      ),
    ).toBe("All 3 pages · B&W · 1 copy · single sided");
    expect(
      describeSelection(
        { pageSequence: [1, 2, 3, 5], colorPages: [2], copies: 2, sides: "double" },
        6,
        formatPageRange,
      ),
    ).toBe("Pages 1-3, 5 · Colour pages 2, rest B&W · 2 copies · double sided");
    expect(
      describeSelection({ pageSequence: [1], colorPages: [1], copies: 1, sides: "single" }, 1, formatPageRange),
    ).toBe("1 page · Colour · 1 copy · single sided");
  });
});
