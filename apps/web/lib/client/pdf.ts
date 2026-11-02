import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type { PDFDocumentProxy };

// pdf.js is large, so it's only loaded once a file is ready to preview. The
// legacy build supports older Android browsers.
let pdfjs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;

function loadPdfjs() {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    return lib;
  });
  return pdfjs;
}

/**
 * Opens a PDF from the customer's own file (no download) or from a signed URL.
 * `close()` frees the worker's memory, even if the file is still loading.
 */
export function openPdf(source: File | string): { promise: Promise<PDFDocumentProxy>; close: () => void } {
  let task: ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['getDocument']> | null = null;
  let closed = false;
  const promise = (async () => {
    const lib = await loadPdfjs();
    const params = typeof source === 'string' ? { url: source } : { data: new Uint8Array(await source.arrayBuffer()) };
    if (closed) throw new Error('closed');
    task = lib.getDocument(params);
    return task.promise;
  })();
  return {
    promise,
    close: () => {
      closed = true;
      void task?.destroy();
    },
  };
}

/** Draws one page into a canvas, sized to the given CSS width. */
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
