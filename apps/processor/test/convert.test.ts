import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ghostscriptGreyscale } from "../src/build.js";
import {
  RejectedFileError,
  assertContentMatches,
  imageToPdf,
  inspectPdf,
  normalizeToPdf,
  officeToPdf,
} from "../src/convert.js";
import { numberedPdf } from "./helpers.js";

const hasGs = (() => {
  try {
    execFileSync("gs", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const gotenbergUrl = process.env.GOTENBERG_URL;

async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#ff0000" } }).png().toBuffer(),
  );
}

describe("assertContentMatches", () => {
  it("accepts matching magic bytes", async () => {
    await expect(assertContentMatches(await numberedPdf(1), "pdf")).resolves.toBeUndefined();
    await expect(assertContentMatches(await png(10, 10), "png")).resolves.toBeUndefined();
  });

  it("rejects renamed files", async () => {
    await expect(assertContentMatches(await png(10, 10), "pdf")).rejects.toBeInstanceOf(
      RejectedFileError,
    );
    await expect(
      assertContentMatches(new TextEncoder().encode("MZ fake exe"), "docx"),
    ).rejects.toBeInstanceOf(RejectedFileError);
  });
});

describe("imageToPdf", () => {
  it("makes one portrait A4 page for a tall image", async () => {
    const doc = await PDFDocument.load(await imageToPdf(await png(600, 1000)));
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  });

  it("makes a landscape page for a wide image", async () => {
    const doc = await PDFDocument.load(await imageToPdf(await png(1600, 900)));
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
  });

  it("honours EXIF rotation from phone cameras", async () => {
    // 1000x600 stored landscape, EXIF orientation 6 = rotate 90° -> displays portrait.
    const jpg = await sharp({ create: { width: 1000, height: 600, channels: 3, background: "#00f" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const doc = await PDFDocument.load(await imageToPdf(new Uint8Array(jpg)));
    expect(doc.getPage(0).getHeight()).toBeGreaterThan(doc.getPage(0).getWidth());
  });

  it("rejects broken images", async () => {
    const broken = (await png(10, 10)).slice(0, 40);
    await expect(imageToPdf(broken)).rejects.toBeInstanceOf(RejectedFileError);
  });
});

describe("inspectPdf", () => {
  it("counts pages", async () => {
    expect(await inspectPdf(await numberedPdf(7))).toEqual({ pageCount: 7 });
  });

  it("rejects garbage and too many pages", async () => {
    await expect(inspectPdf(new TextEncoder().encode("%PDF-1.7 nonsense"))).rejects.toBeInstanceOf(
      RejectedFileError,
    );
    await expect(inspectPdf(await numberedPdf(501))).rejects.toThrow(/limit is 500/);
  });

  it.skipIf(!hasGs)("rejects password-protected PDFs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "enc-"));
    writeFileSync(join(dir, "in.pdf"), await numberedPdf(2));
    execFileSync("gs", [
      "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
      "-sOwnerPassword=owner", "-sUserPassword=user",
      `-sOutputFile=${join(dir, "out.pdf")}`, join(dir, "in.pdf"),
    ]);
    const encrypted = new Uint8Array(readFileSync(join(dir, "out.pdf")));
    await expect(inspectPdf(encrypted)).rejects.toThrow(/password-protected/);
  });
});

describe.skipIf(!hasGs)("ghostscriptGreyscale", () => {
  it("returns a PDF with the same page count", async () => {
    const out = await ghostscriptGreyscale("gs")(await imageToPdf(await png(300, 400)));
    expect(out).not.toBeNull();
    expect((await PDFDocument.load(out!)).getPageCount()).toBe(1);
  });

  it("returns null when ghostscript is missing", async () => {
    expect(await ghostscriptGreyscale("/nonexistent/gs")(await numberedPdf(1))).toBeNull();
  });
});

describe.skipIf(!gotenbergUrl)("officeToPdf (needs GOTENBERG_URL)", () => {
  it("converts a DOCX made by LibreOffice-compatible tooling", async () => {
    // Build a minimal .docx with LibreOffice if available, otherwise skip quietly.
    const dir = mkdtempSync(join(tmpdir(), "docx-"));
    writeFileSync(join(dir, "note.txt"), "Hello from The Print's Project\n\fSecond page");
    try {
      execFileSync("soffice", ["--headless", "--convert-to", "docx", "--outdir", dir, join(dir, "note.txt")], {
        timeout: 60_000,
      });
    } catch {
      return;
    }
    const docx = new Uint8Array(readFileSync(join(dir, "note.docx")));
    const { pageCount } = await normalizeToPdf(docx, "office", "docx", { gotenbergUrl: gotenbergUrl! });
    expect(pageCount).toBeGreaterThanOrEqual(1);
    // Garbage never reaches Gotenberg: the magic-byte check rejects it first.
    await expect(
      normalizeToPdf(new Uint8Array([1, 2, 3]), "office", "docx", { gotenbergUrl: gotenbergUrl! }),
    ).rejects.toBeInstanceOf(RejectedFileError);
    expect((await officeToPdf(docx, "x.docx", gotenbergUrl!)).byteLength).toBeGreaterThan(100);
  }, 120_000);
});
