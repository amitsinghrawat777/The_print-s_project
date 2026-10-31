/**
 * Turning an uploaded file into a normalized PDF, and checking it is safe to print.
 * Pure functions over bytes; storage and DB access live in jobs.ts.
 */
import { fileTypeFromBuffer } from "file-type";
import { PDFDocument, PageSizes } from "pdf-lib";
import sharp, { type OutputInfo } from "sharp";
import { MAX_PAGES_PER_FILE, type FileKind } from "@print/shared";

/** A problem with the customer's file; the message is shown to the customer. */
export class RejectedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RejectedFileError";
  }
}

/** Which sniffed `file-type` extensions are acceptable for each declared extension. */
const SNIFF_MATCH: Record<string, readonly string[]> = {
  pdf: ["pdf"],
  jpg: ["jpg"],
  png: ["png"],
  docx: ["docx", "zip"],
  pptx: ["pptx", "zip"],
  xlsx: ["xlsx", "zip"],
  doc: ["cfb"],
};

/** Checks the file's real contents (magic bytes) match its extension. */
export async function assertContentMatches(bytes: Uint8Array, declaredExt: string): Promise<void> {
  const allowed = SNIFF_MATCH[declaredExt];
  if (!allowed) throw new RejectedFileError("This file type isn't supported");
  const sniffed = await fileTypeFromBuffer(bytes);
  if (!sniffed || !allowed.includes(sniffed.ext)) {
    throw new RejectedFileError(
      `This doesn't look like a real .${declaredExt} file. Please export it again and re-upload.`,
    );
  }
}

const A4 = PageSizes.A4; // [595.28, 841.89] points
const IMAGE_MARGIN = 18; // 1/4 inch
const MAX_IMAGE_EDGE = 3508; // A4 long edge at 300 dpi

/**
 * Photo/scan -> single-page A4 PDF. Applies EXIF rotation (phone photos), picks
 * portrait/landscape from the image shape and fits the image inside small margins.
 */
export async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  let image: { data: Buffer; info: OutputInfo };
  let isPng: boolean;
  try {
    const pipeline = sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true });
    const meta = await sharp(bytes).metadata();
    isPng = meta.format === "png" && meta.hasAlpha === true;
    image = isPng
      ? await pipeline.png().toBuffer({ resolveWithObject: true })
      : await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer({
          resolveWithObject: true,
        });
  } catch {
    throw new RejectedFileError("This image couldn't be opened. Try another photo.");
  }

  const doc = await PDFDocument.create();
  const embedded = isPng ? await doc.embedPng(image.data) : await doc.embedJpg(image.data);
  const landscape = image.info.width > image.info.height;
  const [pw, ph] = landscape ? [A4[1], A4[0]] : [A4[0], A4[1]];
  const scale = Math.min(
    (pw - 2 * IMAGE_MARGIN) / image.info.width,
    (ph - 2 * IMAGE_MARGIN) / image.info.height,
  );
  const w = image.info.width * scale;
  const h = image.info.height * scale;
  const page = doc.addPage([pw, ph]);
  page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return doc.save();
}

/** Office document -> PDF via Gotenberg's LibreOffice route. */
export async function officeToPdf(
  bytes: Uint8Array,
  fileName: string,
  gotenbergUrl: string,
  timeoutMs = 90_000,
): Promise<Uint8Array> {
  const form = new FormData();
  form.append("files", new Blob([bytes]), fileName);
  let res: Response;
  try {
    res = await fetch(new URL("/forms/libreoffice/convert", gotenbergUrl), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Gotenberg unreachable: ${(err as Error).message}`);
  }
  if (res.status === 400) {
    throw new RejectedFileError("This document couldn't be converted. Try saving it as PDF.");
  }
  if (!res.ok) throw new Error(`Gotenberg error ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Opens a PDF and returns its page count, rejecting encrypted, empty or huge files. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if ((err as Error).name === "EncryptedPDFError" || /encrypt/i.test((err as Error).message)) {
      throw new RejectedFileError("This PDF is password-protected. Remove the password and re-upload.");
    }
    throw new RejectedFileError("This PDF is damaged and can't be opened.");
  }
  if (doc.isEncrypted) {
    throw new RejectedFileError("This PDF is password-protected. Remove the password and re-upload.");
  }
  let pageCount: number;
  try {
    pageCount = doc.getPageCount();
    // Touch every page so broken page trees fail here, not at print time.
    doc.getPages().forEach((p) => p.getSize());
  } catch {
    throw new RejectedFileError("This PDF is damaged and can't be opened.");
  }
  if (pageCount < 1) throw new RejectedFileError("This PDF has no pages.");
  if (pageCount > MAX_PAGES_PER_FILE) {
    throw new RejectedFileError(`This file has ${pageCount} pages; the limit is ${MAX_PAGES_PER_FILE}.`);
  }
  return { pageCount };
}

export interface NormalizeOptions {
  gotenbergUrl: string;
}

/** Any accepted upload -> { pdf bytes, page count }. */
export async function normalizeToPdf(
  bytes: Uint8Array,
  kind: FileKind,
  ext: string,
  opts: NormalizeOptions,
): Promise<{ pdf: Uint8Array; pageCount: number }> {
  await assertContentMatches(bytes, ext);
  let pdf: Uint8Array;
  switch (kind) {
    case "pdf":
      pdf = bytes;
      break;
    case "image":
      pdf = await imageToPdf(bytes);
      break;
    case "office":
      // A neutral name: LibreOffice only needs the extension to pick the importer.
      pdf = await officeToPdf(bytes, `document.${ext}`, opts.gotenbergUrl);
      break;
  }
  const { pageCount } = await inspectPdf(pdf);
  return { pdf, pageCount };
}
