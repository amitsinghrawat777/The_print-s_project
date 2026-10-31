import { describe, expect, it } from "vitest";
import { buildPrintFiles, choosePrintMode, type GreyscaleFn } from "../src/build.js";
import { numberedPdf, pageIds } from "./helpers.js";

const noGrey: GreyscaleFn = async () => null;
/** Fake greyscale: same pages, but 1000 points tall so we can tell which copy was used. */
const fakeGrey: GreyscaleFn = async (pdf) => {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(pdf);
  const out = await PDFDocument.create();
  for (const p of src.getPages()) out.addPage([p.getWidth(), 1000]);
  return out.save();
};

describe("choosePrintMode", () => {
  const base = { pageSequence: [1, 2, 3], copies: 1, sides: "single" } as const;
  it("detects single-mode jobs", () => {
    expect(choosePrintMode({ ...base, colorPages: [] }, "split")).toBe("bw_only");
    expect(choosePrintMode({ ...base, colorPages: [1, 2, 3] }, "split")).toBe("color_only");
  });
  it("splits mixed single-sided single-copy jobs when the shop allows", () => {
    expect(choosePrintMode({ ...base, colorPages: [2] }, "split")).toBe("split");
    expect(choosePrintMode({ ...base, colorPages: [2] }, "single_pass")).toBe("single_pass");
  });
  it("forces single pass when duplex or copies would break order", () => {
    expect(choosePrintMode({ ...base, colorPages: [2], sides: "double" }, "split")).toBe("single_pass");
    expect(choosePrintMode({ ...base, colorPages: [2], copies: 2 }, "split")).toBe("single_pass");
  });
});

describe("buildPrintFiles", () => {
  it("keeps only selected pages in the chosen order, with repeats", async () => {
    const pdf = await numberedPdf(5);
    const r = await buildPrintFiles(
      pdf,
      { pageSequence: [5, 3, 3, 1], colorPages: [], copies: 1, sides: "single" },
      "split",
      noGrey,
    );
    expect(r.mode).toBe("split");
    expect(r.color).toBeNull();
    expect(r.bw?.pages).toBe(4);
    expect(await pageIds(r.bw!.bytes)).toEqual([5, 3, 3, 1]);
  });

  it("splits mixed jobs into B&W and colour parts", async () => {
    const pdf = await numberedPdf(6);
    const r = await buildPrintFiles(
      pdf,
      { pageSequence: [1, 2, 3, 4, 5, 6], colorPages: [2, 5], copies: 1, sides: "single" },
      "split",
      noGrey,
    );
    expect(r.mode).toBe("split");
    expect(await pageIds(r.bw!.bytes)).toEqual([1, 3, 4, 6]);
    expect(await pageIds(r.color!.bytes)).toEqual([2, 5]);
  });

  it("puts colour-only jobs in the colour part", async () => {
    const pdf = await numberedPdf(2);
    const r = await buildPrintFiles(
      pdf,
      { pageSequence: [2, 1], colorPages: [1, 2], copies: 3, sides: "double" },
      "split",
      noGrey,
    );
    expect(r.bw).toBeNull();
    expect(await pageIds(r.color!.bytes)).toEqual([2, 1]);
  });

  it("single pass keeps order and takes B&W pages from the greyscale copy", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await numberedPdf(4);
    const r = await buildPrintFiles(
      pdf,
      { pageSequence: [1, 2, 3, 4], colorPages: [3], copies: 1, sides: "double" },
      "split",
      fakeGrey,
    );
    expect(r.mode).toBe("single_pass");
    expect(r.bw).toBeNull();
    expect(r.greyscaleSkipped).toBe(false);
    const doc = await PDFDocument.load(r.color!.bytes);
    expect(doc.getPages().map((p) => [Math.round(p.getWidth()) - 100, p.getHeight()])).toEqual([
      [1, 1000],
      [2, 1000],
      [3, 200],
      [4, 1000],
    ]);
  });

  it("falls back to original pages when greyscale is unavailable", async () => {
    const pdf = await numberedPdf(3);
    const r = await buildPrintFiles(
      pdf,
      { pageSequence: [1, 2, 3], colorPages: [2], copies: 2, sides: "single" },
      "split",
      noGrey,
    );
    expect(r.mode).toBe("single_pass");
    expect(r.greyscaleSkipped).toBe(true);
    expect(await pageIds(r.color!.bytes)).toEqual([1, 2, 3]);
  });

  it("rejects out-of-range pages", async () => {
    const pdf = await numberedPdf(2);
    await expect(
      buildPrintFiles(pdf, { pageSequence: [3], colorPages: [], copies: 1, sides: "single" }, "split", noGrey),
    ).rejects.toThrow(/out of range/);
  });
});
