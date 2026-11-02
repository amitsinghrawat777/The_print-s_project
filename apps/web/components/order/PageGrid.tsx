'use client';

import { useEffect, useRef, useState } from 'react';
import { renderPage, type PDFDocumentProxy } from '@/lib/client/pdf';

const COLLAPSED_COUNT = 8;
const THUMB_WIDTH = 104;

/**
 * Page thumbnails. Tapping a page adds it to or removes it from the order;
 * in mixed mode each page also has a B&W / Colour switch.
 */
export function PageGrid({
  doc,
  pageCount,
  sequence,
  colorPages,
  mixed,
  onTogglePage,
  onToggleColor,
}: {
  doc: PDFDocumentProxy | null;
  pageCount: number;
  sequence: number[];
  colorPages: Set<number>;
  mixed: boolean;
  onTogglePage: (page: number) => void;
  onToggleColor: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(pageCount <= COLLAPSED_COUNT + 4);
  const shown = expanded ? pageCount : COLLAPSED_COUNT;

  // Number pages by print position only when the order isn't simply 1, 2, 3…
  const inOrder = sequence.every((p, i) => i === 0 || p > sequence[i - 1]!);
  const position = new Map<number, number>();
  sequence.forEach((p, i) => {
    if (!position.has(p)) position.set(p, i + 1);
  });

  return (
    <div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: shown }, (_, i) => i + 1).map((page) => (
          <Thumb
            key={page}
            doc={doc}
            page={page}
            order={inOrder ? null : (position.get(page) ?? null)}
            selected={position.has(page)}
            color={colorPages.has(page)}
            mixed={mixed}
            onToggle={() => onTogglePage(page)}
            onToggleColor={() => onToggleColor(page)}
          />
        ))}
      </ul>
      {pageCount > shown && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
        >
          Show all {pageCount} pages
        </button>
      )}
    </div>
  );
}

function Thumb({
  doc,
  page,
  order,
  selected,
  color,
  mixed,
  onToggle,
  onToggleColor,
}: {
  doc: PDFDocumentProxy | null;
  page: number;
  order: number | null;
  selected: boolean;
  color: boolean;
  mixed: boolean;
  onToggle: () => void;
  onToggleColor: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'waiting' | 'done' | 'error'>('waiting');

  // Render only when scrolled near, so long documents stay light on phones.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        renderPage(doc, page, canvas, THUMB_WIDTH)
          .then(() => !cancelled && setState('done'))
          .catch(() => !cancelled && setState('error'));
      },
      { rootMargin: '300px' },
    );
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc, page]);

  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`Page ${page}${selected ? ', will print' : ', skipped'}`}
        className={`relative aspect-[1/1.414] overflow-hidden rounded-lg border-2 bg-white transition ${
          selected ? 'border-blue-600' : 'border-slate-200 opacity-45'
        }`}
      >
        <canvas
          ref={canvasRef}
          className={`h-full w-full object-contain ${state === 'done' ? '' : 'invisible'} ${
            color || !selected ? '' : 'grayscale'
          }`}
        />
        {state !== 'done' && (
          <span className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden>
            {state === 'error' && <span className="absolute inset-0 grid place-items-center text-xs text-slate-400">No preview</span>}
          </span>
        )}
        <span className="absolute bottom-1 left-1 rounded bg-slate-900/75 px-1.5 text-xs font-medium text-white tabular-nums">
          {page}
        </span>
        {selected && order !== null && (
          <span className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">
            {order}
          </span>
        )}
        {!selected && (
          <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-slate-700">Skipped</span>
        )}
      </button>
      {mixed && selected && (
        <button
          type="button"
          onClick={onToggleColor}
          aria-pressed={color}
          aria-label={`Page ${page} in ${color ? 'colour' : 'black and white'}`}
          className={`rounded-md py-1 text-xs font-semibold ${
            color ? 'bg-gradient-to-r from-pink-500 via-amber-400 to-sky-500 text-white' : 'bg-slate-200 text-slate-700'
          }`}
        >
          {color ? 'Colour' : 'B&W'}
        </button>
      )}
    </li>
  );
}
