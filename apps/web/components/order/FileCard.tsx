'use client';

import { useEffect, useState } from 'react';
import {
  availableOptions,
  formatPageRange,
  formatPaise,
  isAllPagesInOrder,
  parsePageRange,
  type FilePrice,
  type PaperSize,
} from '@prints/shared';
import { openPdf, type PDFDocumentProxy } from '@/lib/client/pdf';
import type { PublicShop } from '@/lib/types';
import { Field, Segmented, Spinner, Stepper } from '../ui';
import { colorPagesOf, formatBytes, type ColorChoice, type FileChoices, type OrderFile } from './model';
import { PageGrid } from './PageGrid';

export function FileCard({
  file,
  index,
  count,
  shop,
  price,
  onChange,
  onRemove,
  onMove,
}: {
  file: OrderFile;
  index: number;
  count: number;
  shop: PublicShop;
  price: FilePrice | string | null;
  onChange: (choices: FileChoices) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const doc = usePdf(file);
  const { choices, pageCount } = file;
  const set = (patch: Partial<FileChoices>) => onChange({ ...choices, ...patch });
  const options = availableOptions(shop.rates, choices.paperSize, shop.duplexAvailable);

  const setSequence = (pageSequence: number[]) =>
    set({
      pageSequence,
      rangeText: pageCount && isAllPagesInOrder(pageSequence, pageCount) ? '' : formatPageRange(pageSequence),
      rangeError: pageSequence.length ? null : 'Choose at least one page',
    });

  const onRangeText = (rangeText: string) => {
    const parsed = parsePageRange(rangeText, pageCount ?? 0);
    set(parsed.ok ? { rangeText, rangeError: null, pageSequence: parsed.pages } : { rangeText, rangeError: parsed.error });
  };

  const togglePage = (page: number) =>
    setSequence(
      choices.pageSequence.includes(page)
        ? choices.pageSequence.filter((p) => p !== page)
        : [...choices.pageSequence, page],
    );

  const toggleColor = (page: number) =>
    set({
      mixedColorPages: choices.mixedColorPages.includes(page)
        ? choices.mixedColorPages.filter((p) => p !== page)
        : [...choices.mixedColorPages, page].sort((a, b) => a - b),
    });

  const colorOptions: { value: ColorChoice; label: string }[] = [
    ...(options.bw ? [{ value: 'bw' as const, label: 'B&W' }] : []),
    ...(options.color ? [{ value: 'color' as const, label: 'Colour' }] : []),
    ...(options.bw && options.color && (pageCount ?? 0) > 1 ? [{ value: 'mixed' as const, label: 'Mixed' }] : []),
  ];

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start gap-3 p-4">
        <FileIcon name={file.name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-900">{file.name}</h3>
          <p className="text-sm text-slate-500">
            {pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} · ` : ''}
            {formatBytes(file.size)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {count > 1 && (
            <>
              <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
                ↑
              </IconButton>
              <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
                ↓
              </IconButton>
            </>
          )}
          <IconButton label={`Remove ${file.name}`} onClick={onRemove}>
            ✕
          </IconButton>
        </div>
      </header>

      {file.phase === 'uploading' && (
        <div className="px-4 pb-4">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(file.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${file.name}`}>
            <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${Math.max(4, file.progress * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-slate-500">Uploading… {Math.round(file.progress * 100)}%</p>
        </div>
      )}

      {file.phase === 'processing' && (
        <p className="flex items-center gap-2 px-4 pb-4 text-sm text-slate-600">
          <Spinner /> {/\.pdf$/i.test(file.name) ? 'Counting pages…' : 'Converting to PDF…'}
        </p>
      )}

      {file.phase === 'rejected' && (
        <p className="mx-4 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {file.error ?? "This file couldn't be used."}
        </p>
      )}

      {file.phase === 'ready' && pageCount && (
        <div className="space-y-5 border-t border-slate-100 p-4">
          <Field label="Pages to print" hint="e.g. 1-5, 8 or 5-1 for reverse">
            <input
              value={choices.rangeText}
              onChange={(e) => onRangeText(e.target.value)}
              placeholder={`All ${pageCount} pages`}
              inputMode="text"
              aria-invalid={!!choices.rangeError}
              className={`w-full rounded-xl border px-3 py-2.5 text-base outline-none focus:ring-2 ${
                choices.rangeError ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'
              }`}
            />
            {choices.rangeError && <p className="text-sm text-red-700">{choices.rangeError}</p>}
          </Field>

          <PageGrid
            doc={doc}
            pageCount={pageCount}
            sequence={choices.pageSequence}
            colorPages={new Set(colorPagesOf(file))}
            mixed={choices.colorChoice === 'mixed'}
            onTogglePage={togglePage}
            onToggleColor={toggleColor}
          />

          {colorOptions.length > 1 && (
            <Field label="Print in" hint={choices.colorChoice === 'mixed' ? 'Pick B&W or Colour under each page' : undefined}>
              <Segmented label="Colour" value={choices.colorChoice} options={colorOptions} onChange={(colorChoice) => set({ colorChoice })} />
            </Field>
          )}

          {options.double && (
            <Field label="Sides">
              <Segmented
                label="Sides"
                value={choices.sides}
                options={[
                  { value: 'single', label: 'One side' },
                  { value: 'double', label: 'Both sides' },
                ]}
                onChange={(sides) => set({ sides })}
              />
            </Field>
          )}

          {shop.paperSizes.length > 1 && (
            <Field label="Paper">
              <Segmented
                label="Paper size"
                value={choices.paperSize}
                options={shop.paperSizes.map((s) => ({ value: s, label: s }))}
                onChange={(paperSize: PaperSize) => {
                  const next = availableOptions(shop.rates, paperSize, shop.duplexAvailable);
                  set({ paperSize, sides: next.double ? choices.sides : 'single' });
                }}
              />
            </Field>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Copies</span>
            <Stepper label="Copies" value={choices.copies} min={1} max={50} onChange={(copies) => set({ copies })} />
          </div>
        </div>
      )}

      {file.phase === 'ready' && price !== null && (
        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm">
          {typeof price === 'string' ? (
            <span className="text-red-700">{price}</span>
          ) : (
            <>
              <span className="text-slate-600">{describePrice(price, choices.sides)}</span>
              <span className="font-semibold text-slate-900 tabular-nums">{formatPaise(price.pricePaise)}</span>
            </>
          )}
        </footer>
      )}
    </article>
  );
}

export function describePrice(price: FilePrice, sides: 'single' | 'double'): string {
  const parts: string[] = [];
  if (price.bwPages) parts.push(`${price.bwPages} B&W`);
  if (price.colorPages) parts.push(`${price.colorPages} colour`);
  let text = `${parts.join(' + ')} page${price.bwPages + price.colorPages === 1 ? '' : 's'}`;
  if (sides === 'double') text += ` on ${price.sheets} sheet${price.sheets === 1 ? '' : 's'}`;
  if (price.copies > 1) text += ` × ${price.copies} copies`;
  return text;
}

/** Opens the file for thumbnails: the customer's own PDF, or the converted one. */
function usePdf(file: OrderFile): PDFDocumentProxy | null {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const isLocalPdf = !!file.local && (file.local.type === 'application/pdf' || /\.pdf$/i.test(file.local.name));
  const source = file.phase !== 'ready' ? null : isLocalPdf ? file.local : file.previewUrl;

  useEffect(() => {
    if (!source) return;
    const pdf = openPdf(source);
    pdf.promise.then(setDoc).catch(() => {});
    return () => pdf.close();
  }, [source]);

  return source ? doc : null;
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toUpperCase().slice(0, 4) ?? '';
  const tone = /PDF/.test(ext)
    ? 'bg-red-100 text-red-700'
    : /DOC/.test(ext)
      ? 'bg-blue-100 text-blue-700'
      : /PPT/.test(ext)
        ? 'bg-orange-100 text-orange-700'
        : /XLS/.test(ext)
          ? 'bg-green-100 text-green-700'
          : 'bg-violet-100 text-violet-700';
  return (
    <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-[11px] font-bold ${tone}`} aria-hidden>
      {ext}
    </span>
  );
}
