import { PDFDocument } from "pdf-lib";

/** A PDF whose page N is (100 + N) points wide, so pages are identifiable after copying. */
export async function numberedPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= pageCount; n++) doc.addPage([100 + n, 200]);
  return doc.save();
}

/** Reads back which source pages a built PDF contains, in order. */
export async function pageIds(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()) - 100);
}
