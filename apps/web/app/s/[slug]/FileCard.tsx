"use client";

import { MAX_COPIES, formatPaise, type FilePrice, type Sides } from "@print/shared";
import { Field, Segmented, Spinner, Stepper, cx, formatBytes } from "@/components/ui";
import type { ColorChoice, FileOptions, SelectionResult, ShopOptions } from "@/lib/client/order";

export type Phase = "uploading" | "processing" | "ready" | "rejected" | "error";

export interface Entry {
  key: string;
  fileId?: string;
  name: string;
  size: number;
  phase: Phase;
  progress: number;
  error?: string;
  pageCount?: number;
  previewUrl?: string | null;
}

interface Props {
  entry: Entry;
  index: number;
  count: number;
  options: FileOptions | undefined;
  shop: ShopOptions;
  selection: SelectionResult | undefined;
  price: { ok: true; value: FilePrice } | { ok: false; error: string } | undefined;
  onChange: (next: FileOptions) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

export function FileCard({ entry, index, count, options, shop, selection, price, onChange, onRemove, onMove }: Props) {
  const ready = entry.phase === "ready" && options && entry.pageCount;
  const set = <K extends keyof FileOptions>(key: K, value: FileOptions[K]) =>
    options && onChange({ ...options, [key]: value });

  return (
    <li className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
      <div className="flex items-start gap-3 p-4">
        <div
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-sm font-semibold text-brand-700"
        >
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={entry.name}>
            {entry.name}
          </p>
          <p className="text-sm text-gray-500">
            {formatBytes(entry.size)}
            {entry.pageCount ? ` · ${entry.pageCount} page${entry.pageCount === 1 ? "" : "s"}` : ""}
          </p>
          <Status entry={entry} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            aria-label={`Remove ${entry.name}`}
          >
            Remove
          </button>
          {count > 1 && (
            <div className="flex gap-1">
              <button
                type="button"
                className="grid size-8 place-items-center rounded-lg bg-gray-100 disabled:opacity-30"
                aria-label="Print this file earlier"
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="grid size-8 place-items-center rounded-lg bg-gray-100 disabled:opacity-30"
                aria-label="Print this file later"
                disabled={index === count - 1}
                onClick={() => onMove(1)}
              >
                ↓
              </button>
            </div>
          )}
        </div>
      </div>

      {ready && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <Field
            label="Pages"
            hint={
              selection && !selection.ok && selection.field === "range" ? (
                <p className="text-sm text-red-600">{selection.error}</p>
              ) : (
                <p className="text-xs text-gray-500">
                  Leave empty for all pages. Order matters: <b>5-1</b> prints backwards.
                </p>
              )
            }
          >
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder={`All pages (1-${entry.pageCount})`}
                className={cx(
                  "h-11 w-full rounded-xl border px-3 text-base",
                  selection && !selection.ok && selection.field === "range" ? "border-red-400" : "border-gray-200",
                )}
                value={options.range}
                onChange={(e) => set("range", e.target.value)}
              />
              {entry.previewUrl && (
                <a
                  href={entry.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-11 shrink-0 place-items-center rounded-xl bg-gray-100 px-3 text-sm font-medium"
                >
                  Preview
                </a>
              )}
            </div>
          </Field>

          <Field label="Colour">
            <Segmented<ColorChoice>
              label="Colour"
              value={options.color}
              onChange={(v) => set("color", v)}
              options={[
                { value: "bw", label: "B&W", disabled: !shop.canBw(options.sides, options.paperSize) },
                { value: "color", label: "Colour", disabled: !shop.canColor(options.sides, options.paperSize) },
                {
                  value: "mixed",
                  label: "Mixed",
                  disabled:
                    !shop.canBw(options.sides, options.paperSize) ||
                    !shop.canColor(options.sides, options.paperSize),
                },
              ]}
            />
            {options.color === "mixed" && (
              <div className="pt-2">
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="Which pages in colour? e.g. 1, 4"
                  className={cx(
                    "h-11 w-full rounded-xl border px-3 text-base",
                    selection && !selection.ok && selection.field === "colorRange"
                      ? "border-red-400"
                      : "border-gray-200",
                  )}
                  value={options.colorRange}
                  onChange={(e) => set("colorRange", e.target.value)}
                />
                {selection && !selection.ok && selection.field === "colorRange" ? (
                  <p className="pt-1 text-sm text-red-600">{selection.error}</p>
                ) : (
                  <p className="pt-1 text-xs text-gray-500">All other pages print in B&W.</p>
                )}
              </div>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Copies">
              <Stepper label="copies" value={options.copies} min={1} max={MAX_COPIES} onChange={(v) => set("copies", v)} />
            </Field>
            {shop.canDouble(options.paperSize) && (
              <Field label="Sides">
                <Segmented<Sides>
                  label="Sides"
                  value={options.sides}
                  onChange={(v) => set("sides", v)}
                  options={[
                    { value: "single", label: "Single" },
                    { value: "double", label: "Double" },
                  ]}
                />
              </Field>
            )}
          </div>

          {shop.paperSizes.length > 1 && (
            <Field label="Paper">
              <Segmented
                label="Paper size"
                value={options.paperSize}
                onChange={(v) => set("paperSize", v)}
                options={shop.paperSizes.map((p) => ({ value: p, label: p }))}
              />
            </Field>
          )}

          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-sm">
            {price?.ok ? (
              <>
                <span className="text-gray-600">
                  {price.value.bwPages > 0 && `${price.value.bwPages} B&W`}
                  {price.value.bwPages > 0 && price.value.colorPages > 0 && " + "}
                  {price.value.colorPages > 0 && `${price.value.colorPages} colour`}
                  {` × ${price.value.copies}`}
                </span>
                <span className="font-semibold">{formatPaise(price.value.totalPaise)}</span>
              </>
            ) : (
              <span className="text-red-600">{price?.error ?? "Check the options above"}</span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Status({ entry }: { entry: Entry }) {
  switch (entry.phase) {
    case "uploading":
      return (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width]"
              style={{ width: `${Math.round(entry.progress * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">Uploading… {Math.round(entry.progress * 100)}%</p>
        </div>
      );
    case "processing":
      return (
        <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
          <Spinner className="text-brand-500" /> Counting pages…
        </p>
      );
    case "rejected":
    case "error":
      return <p className="mt-1 text-sm text-red-600">{entry.error ?? "This file can't be printed."}</p>;
    default:
      return null;
  }
}
