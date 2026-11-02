import { useEffect, useRef, useState } from 'react';
import { openPdf, pageAspect, renderPage, type PDFDocumentProxy } from '../lib/pdf';
import { Button, Spinner } from './ui';

export interface PageTag {
  /** e.g. "Page 5" (its number in the customer's original file) */
  label: string;
  color: boolean;
}

/**
 * Scrollable preview of a PDF held in memory. Pages are drawn only when they
 * scroll into view, so a 300-page file opens instantly.
 */
export function PdfViewer({ bytes, tags }: { bytes: Uint8Array; tags: PageTag[] }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [aspects, setAspects] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    setDoc(null);
    setError(null);
    const { promise, close } = openPdf(bytes);
    let cancelled = false;
    promise
      .then(async (d) => {
        // the first page's shape is a good guess for all of them until each one is drawn
        const first = await pageAspect(d, 1);
        if (cancelled) return;
        setAspects(Array.from({ length: d.numPages }, () => first));
        setDoc(d);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      close();
    };
  }, [bytes]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(200, Math.min(width - 48, 900) * zoom);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <span className="text-slate-500">{doc ? `${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · preview only, nothing is saved` : 'Loading…'}</span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</Button>
          <button type="button" className="w-14 text-center tabular-nums text-slate-600 hover:text-slate-900" onClick={() => setZoom(1)} title="Fit width">
            {Math.round(zoom * 100)}%
          </button>
          <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</Button>
        </span>
      </div>
      <div ref={scroller} className="flex-1 overflow-auto bg-slate-200/70 py-6" data-testid="pdf-scroller">
        {error && <p className="text-center text-sm text-red-700">Could not show this file: {error}</p>}
        {!doc && !error && (
          <p className="flex items-center justify-center gap-2 text-sm text-slate-500"><Spinner /> Opening…</p>
        )}
        {doc && (
          <div className="flex flex-col items-center gap-6">
            {aspects.map((aspect, i) => (
              <Page
                key={i}
                doc={doc}
                number={i + 1}
                width={pageWidth}
                aspect={aspect}
                tag={tags[i]}
                root={scroller.current}
                onAspect={(a) => setAspects((list) => (list[i] === a ? list : list.map((x, j) => (j === i ? a : x))))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Page({
  doc,
  number,
  width,
  aspect,
  tag,
  root,
  onAspect,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
  aspect: number;
  tag: PageTag | undefined;
  root: HTMLElement | null;
  onAspect: (aspect: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { root, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    void pageAspect(doc, number).then((a) => !cancelled && onAspect(a));
    renderPage(doc, number, canvas.current, width)
      .then(() => !cancelled && setDrawn(true))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // onAspect is stable enough; redraw only when what's shown changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, doc, number, width]);

  return (
    <figure className="relative" style={{ width }}>
      <div ref={box} className="overflow-hidden bg-white shadow-md" style={{ width, height: width / aspect }} data-testid="pdf-page">
        <canvas ref={canvas} className={`block size-full transition-opacity ${drawn ? 'opacity-100' : 'opacity-0'}`} />
      </div>
      <figcaption className="mt-1.5 flex items-center justify-center gap-2 text-xs text-slate-500">
        <span>{number}</span>
        {tag && <span>· {tag.label}</span>}
        {tag && (
          <span className={`rounded px-1.5 py-0.5 font-medium ${tag.color ? 'bg-fuchsia-100 text-fuchsia-800' : 'bg-slate-200 text-slate-700'}`}>
            {tag.color ? 'Colour' : 'B&W'}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
