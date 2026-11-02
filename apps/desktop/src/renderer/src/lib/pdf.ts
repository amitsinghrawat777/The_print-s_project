import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type { PDFDocumentProxy };

GlobalWorkerOptions.workerSrc = workerUrl;

/** Opens PDF bytes from memory. `close()` frees the worker even mid-load. */
export function openPdf(bytes: Uint8Array) {
  // pdf.js takes ownership of the buffer it is given, so it gets a copy
  const task = getDocument({ data: bytes.slice() });
  return { promise: task.promise, close: () => void task.destroy() };
}

/** Draws one page into a canvas at the given CSS width. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = (cssWidth * Math.min(window.devicePixelRatio || 1, 2)) / base.width;
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
}

/** Page width / height for laying out placeholders before a page is drawn. */
export async function pageAspect(doc: PDFDocumentProxy, pageNumber: number) {
  const page = await doc.getPage(pageNumber);
  const v = page.getViewport({ scale: 1 });
  return v.width / v.height;
}
