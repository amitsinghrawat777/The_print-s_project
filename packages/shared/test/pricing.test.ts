import { describe, expect, it } from "vitest";
import { formatPaise, roundToRupee } from "../src/money.js";
import { PricingError, priceFile, priceJob, type RateRow } from "../src/pricing.js";

// The example rate card from MVP_PLAN.md: ₹2 / ₹3 B&W, ₹10 / ₹18 colour.
const rates: RateRow[] = [
  { paperSize: "A4", colorMode: "bw", sides: "single", pricePaise: 200 },
  { paperSize: "A4", colorMode: "bw", sides: "double", pricePaise: 300 },
  { paperSize: "A4", colorMode: "color", sides: "single", pricePaise: 1000 },
  { paperSize: "A4", colorMode: "color", sides: "double", pricePaise: 1800 },
];

const seq = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("priceFile — single sided", () => {
  it("charges per page per copy", () => {
    const p = priceFile(
      { pageSequence: seq(3), colorPages: [], copies: 2, sides: "single", paperSize: "A4" },
      rates,
    );
    expect(p).toMatchObject({ bwPages: 3, colorPages: 0, sheets: 3, perCopyPaise: 600 });
    expect(p.totalPaise).toBe(1200);
  });

  it("mixes B&W and colour pages", () => {
    const p = priceFile(
      { pageSequence: seq(12), colorPages: [1, 4], copies: 1, sides: "single", paperSize: "A4" },
      rates,
    );
    expect(p.bwPages).toBe(10);
    expect(p.colorPages).toBe(2);
    expect(p.totalPaise).toBe(10 * 200 + 2 * 1000);
  });

  it("charges repeated pages each time they print", () => {
    const p = priceFile(
      { pageSequence: [1, 1, 1], colorPages: [1], copies: 1, sides: "single", paperSize: "A4" },
      rates,
    );
    expect(p.colorPages).toBe(3);
    expect(p.totalPaise).toBe(3000);
  });

  it("ignores colour marks on pages that are not printed", () => {
    const p = priceFile(
      { pageSequence: [2, 3], colorPages: [1], copies: 1, sides: "single", paperSize: "A4" },
      rates,
    );
    expect(p.colorPages).toBe(0);
    expect(p.totalPaise).toBe(400);
  });
});

describe("priceFile — double sided", () => {
  it("charges per sheet", () => {
    const p = priceFile(
      { pageSequence: seq(4), colorPages: [], copies: 1, sides: "double", paperSize: "A4" },
      rates,
    );
    expect(p.sheets).toBe(2);
    expect(p.totalPaise).toBe(600);
  });

  it("charges a leftover last page at the single-sided rate", () => {
    const p = priceFile(
      { pageSequence: seq(5), colorPages: [], copies: 1, sides: "double", paperSize: "A4" },
      rates,
    );
    expect(p.sheets).toBe(3);
    expect(p.totalPaise).toBe(300 + 300 + 200);
  });

  it("charges a sheet as colour when either side is colour", () => {
    const p = priceFile(
      { pageSequence: seq(5), colorPages: [2, 5], copies: 3, sides: "double", paperSize: "A4" },
      rates,
    );
    // sheet1 (1,2c) colour 1800, sheet2 (3,4) bw 300, sheet3 (5c alone) colour single 1000
    expect(p.perCopyPaise).toBe(1800 + 300 + 1000);
    expect(p.totalPaise).toBe(3 * 3100);
  });
});

describe("priceFile — validation", () => {
  it("throws when the shop has no rate for the option", () => {
    expect(() =>
      priceFile(
        { pageSequence: [1], colorPages: [], copies: 1, sides: "single", paperSize: "A3" },
        rates,
      ),
    ).toThrow(PricingError);
  });

  it("does not need a colour rate for B&W-only orders", () => {
    const bwOnly = rates.filter((r) => r.colorMode === "bw");
    expect(
      priceFile(
        { pageSequence: [1], colorPages: [], copies: 1, sides: "single", paperSize: "A4" },
        bwOnly,
      ).totalPaise,
    ).toBe(200);
  });

  it("rejects bad copies and empty selections", () => {
    const base = { colorPages: [], sides: "single", paperSize: "A4" } as const;
    expect(() => priceFile({ ...base, pageSequence: [1], copies: 0 }, rates)).toThrow();
    expect(() => priceFile({ ...base, pageSequence: [1], copies: 101 }, rates)).toThrow();
    expect(() => priceFile({ ...base, pageSequence: [], copies: 1 }, rates)).toThrow();
  });
});

describe("priceJob", () => {
  it("matches the MVP plan example (₹12 + ₹40 = ₹52)", () => {
    const job = priceJob(
      [
        { pageSequence: seq(3), colorPages: [], copies: 2, sides: "single", paperSize: "A4" },
        { pageSequence: seq(12), colorPages: [11, 12], copies: 1, sides: "single", paperSize: "A4" },
      ],
      rates,
    );
    expect(job.files.map((f) => f.totalPaise)).toEqual([1200, 4000]);
    expect(job.totalPaise).toBe(5200);
    expect(formatPaise(job.totalPaise)).toBe("₹52");
  });

  it("rounds only the final total to the nearest rupee", () => {
    const halfRupee: RateRow[] = [
      { paperSize: "A4", colorMode: "bw", sides: "single", pricePaise: 150 },
    ];
    const job = priceJob(
      [{ pageSequence: [1], colorPages: [], copies: 3, sides: "single", paperSize: "A4" }],
      halfRupee,
    );
    expect(job.subtotalPaise).toBe(450);
    expect(job.totalPaise).toBe(500);
  });
});

describe("money", () => {
  it("rounds half up and formats", () => {
    expect(roundToRupee(449)).toBe(400);
    expect(roundToRupee(450)).toBe(500);
    expect(formatPaise(250)).toBe("₹2.50");
    expect(formatPaise(125000)).toBe("₹1,250");
  });
});
