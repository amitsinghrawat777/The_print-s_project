import { fileTypeFromBuffer } from 'file-type';
import { PDFDocument } from 'pdf-lib';
import {
  fileTypeFromExtension,
  MAX_PAGES_PER_FILE,
  type AcceptedFileType,
} from '@prints/shared';

/** A problem with the customer's file. The message is shown to them. */
export class RejectedFileError extends Error {
  override name = 'RejectedFileError';
}

const OFFICE_ZIP = new Set(['docx', 'pptx', 'xlsx']);
const OFFICE_OLE = new Set(['doc', 'ppt', 'xls']);

/**
 * Works out what a file really is from its bytes. The extension the customer's
 * file had is only trusted where the bytes can't tell Office formats apart.
 */
export async function detectFileType(bytes: Uint8Array, declaredExt: string): Promise<AcceptedFileType> {
  const detected = await fileTypeFromBuffer(bytes);
  const ext = detected?.ext;

  let resolved: AcceptedFileType | null = null;
  if (ext === 'pdf' || ext === 'jpg' || ext === 'png' || (ext && OFFICE_ZIP.has(ext))) {
    resolved = fileTypeFromExtension(ext);
  } else if (ext === 'cfb' && OFFICE_OLE.has(declaredExt)) {
    resolved = fileTypeFromExtension(declaredExt);
  } else if (ext === 'zip' && OFFICE_ZIP.has(declaredExt)) {
    resolved = fileTypeFromExtension(declaredExt);
  }

  if (!resolved) {
    throw new RejectedFileError(
      "This file type isn't supported. Upload a PDF, Word, PowerPoint, Excel, JPG or PNG file.",
    );
  }
  return resolved;
}

/** Opens a PDF and returns its page count, rejecting files we can't print. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  let pageCount: number;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // pdf-lib loads some broken files without complaint and fails here instead
    pageCount = doc.getPageCount();
  } catch (error) {
    if (error instanceof Error && error.name === 'EncryptedPDFError') {
      throw new RejectedFileError('This PDF is password-protected. Remove the password and upload it again.');
    }
    throw new RejectedFileError("This PDF looks damaged and can't be opened.");
  }
  if (pageCount === 0) throw new RejectedFileError('This PDF has no pages.');
  if (pageCount > MAX_PAGES_PER_FILE) {
    throw new RejectedFileError(
      `This file has ${pageCount} pages. The limit is ${MAX_PAGES_PER_FILE} pages per file.`,
    );
  }
  return { pageCount };
}

// A4 in PDF points, with a small margin so printers don't clip the image.
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 18;

/** Puts a JPG or PNG on one A4 page, turned landscape for wide images. */
export async function imageToPdf(bytes: Uint8Array, ext: 'jpg' | 'jpeg' | 'png'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let image;
  try {
    image = ext === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    throw new RejectedFileError("This image looks damaged and can't be opened.");
  }
  const landscape = image.width > image.height;
  const [pageWidth, pageHeight] = landscape ? [A4[1], A4[0]] : A4;
  const scale = Math.min(
    (pageWidth - 2 * MARGIN) / image.width,
    (pageHeight - 2 * MARGIN) / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  const page = doc.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  return doc.save();
}

/** Converts a Word, PowerPoint or Excel file to PDF with Gotenberg (LibreOffice). */
export async function officeToPdf(gotenbergUrl: string, bytes: Uint8Array, ext: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append('files', new Blob([bytes as Uint8Array<ArrayBuffer>]), `document.${ext}`);
  let response: Response;
  try {
    response = await fetch(new URL('/forms/libreoffice/convert', gotenbergUrl), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Error(`Gotenberg request failed: ${(error as Error).message}`);
  }
  if (response.status === 400) {
    throw new RejectedFileError("This document couldn't be opened. Try saving it as a PDF and uploading that.");
  }
  if (!response.ok) {
    throw new Error(`Gotenberg returned ${response.status}: ${await response.text()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Copies the given 1-based pages, in order, into a new PDF. */
export async function extractPages(source: PDFDocument, pages: readonly number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pages.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return out.save();
}
