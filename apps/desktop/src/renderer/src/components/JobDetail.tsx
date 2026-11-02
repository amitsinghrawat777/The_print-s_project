import { formatPageRange, isAllPagesInOrder, type PrintPart } from '@prints/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopSettings, PrinterInfo } from '../../../ipc';
import { loadPdfBytes } from '../lib/files';
import { colourLabel, formatPaise, pagesLabel, STATUS_LABEL, STATUS_STYLE, timeOf } from '../lib/format';
import { setJobStatus, setPaid } from '../lib/jobActions';
import type { Job, JobFile } from '../lib/types';
import { PdfViewer, type PageTag } from './PdfViewer';
import { Button, ErrorNote, Spinner } from './ui';

interface PartRef {
  key: string;
  file: JobFile;
  part: PrintPart;
}

function partTitle(part: PrintPart) {
  const pages = `${part.pages.length} page${part.pages.length === 1 ? '' : 's'}`;
  if (part.kind === 'bw') return `B&W · ${pages}`;
  return part.mixed ? `Colour printer (mixed) · ${pages}` : `Colour · ${pages}`;
}

/**
 * Settings that differ from a plain print (all pages, B&W, 1 copy, one side, A4).
 * These cause costly reprints when missed, so they're shown as big chips.
 */
function attentionChips(file: JobFile): { label: string; tone: string }[] {
  const seq = file.page_sequence ?? [];
  const colour = seq.filter((p) => file.color_pages.includes(p));
  const chips: { label: string; tone: string }[] = [];
  if (!(file.page_count && isAllPagesInOrder(seq, file.page_count))) {
    chips.push({ label: `Pages ${formatPageRange(seq)} of ${file.page_count ?? '?'}`, tone: 'bg-accent text-white' });
  }
  if (colour.length === seq.length && seq.length > 0) chips.push({ label: 'Colour', tone: 'bg-fuchsia-600 text-white' });
  else if (colour.length > 0) chips.push({ label: `Colour: p. ${formatPageRange([...new Set(colour)])}`, tone: 'bg-fuchsia-600 text-white' });
  if (file.copies > 1) chips.push({ label: `${file.copies} copies`, tone: 'bg-accent text-white' });
  if (file.sides === 'double') chips.push({ label: 'Both sides', tone: 'bg-accent text-white' });
  if (file.paper_size !== 'A4') chips.push({ label: file.paper_size, tone: 'bg-accent text-white' });
  return chips;
}

function pageTags(file: JobFile, part: PrintPart): PageTag[] {
  const colour = new Set(file.color_pages);
  return part.pages.map((p) => ({ label: `page ${p} of original`, color: part.kind === 'color' && (!part.mixed || colour.has(p)) }));
}

export function JobDetail({
  job,
  printers,
  settings,
  onChanged,
}: {
  job: Job;
  printers: PrinterInfo[];
  settings: DesktopSettings;
  onChanged: () => void;
}) {
  const parts: PartRef[] = useMemo(
    () => job.job_files.flatMap((file) => file.print_parts.map((part, i) => ({ key: `${file.id}:${i}`, file, part }))),
    [job.job_files],
  );
  const [selected, setSelected] = useState<string | null>(parts[0]?.key ?? null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [printed, setPrinted] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<{ bw?: string; color?: string }>({});
  // the job prop lags behind our own updates until the queue refreshes
  const status = useRef(job.status);
  useEffect(() => {
    status.current = job.status;
  }, [job.status]);

  const terminal = job.status === 'done' || job.status === 'failed' || job.status === 'expired';
  // files are deleted after collection (and when an order expires), so don't try to fetch them
  const filesGone = job.status === 'done' || job.status === 'expired';

  // Opening an order tells the customer the shop has seen it.
  useEffect(() => {
    setSelected(parts[0]?.key ?? null);
    setPrinted(new Set());
    setMessage(null);
    setOverride({});
    if (job.status === 'new') {
      void setJobStatus(job, 'opened').then((err) => (err ? setMessage({ kind: 'error', text: err }) : onChanged()));
    }
    // fetch every part in the background so Print is instant
    if (!filesGone) for (const p of parts) void loadPdfBytes(p.part.path).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  const current = parts.find((p) => p.key === selected) ?? parts[0];
  useEffect(() => {
    if (!current || filesGone) return;
    let cancelled = false;
    setBytes(null);
    setLoadError(null);
    loadPdfBytes(current.part.path)
      .then((b) => !cancelled && setBytes(b))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [current?.part.path, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallback = printers.find((p) => p.isDefault)?.name ?? printers[0]?.name ?? null;
  const printerFor = (kind: 'bw' | 'color') => {
    const wanted = override[kind] ?? (kind === 'bw' ? settings.bwPrinter : settings.colorPrinter);
    return wanted && printers.some((p) => p.name === wanted) ? wanted : fallback;
  };
  const missingSaved = (['bw', 'color'] as const).filter((k) => {
    const saved = k === 'bw' ? settings.bwPrinter : settings.colorPrinter;
    return saved && !printers.some((p) => p.name === saved);
  });

  async function move(to: Parameters<typeof setJobStatus>[1], extra?: { paid_at_counter?: boolean }) {
    const err = await setJobStatus({ ...job, status: status.current }, to, extra);
    if (err) {
      setMessage({ kind: 'error', text: err });
      return false;
    }
    if (status.current !== to) status.current = to;
    onChanged();
    return true;
  }

  async function printOne(p: PartRef): Promise<boolean> {
    const printer = printerFor(p.part.kind);
    if (!printer) {
      setMessage({ kind: 'error', text: 'No printer found. Add a printer in your computer settings, then pick it in Settings.' });
      return false;
    }
    const pdf = await loadPdfBytes(p.part.path);
    const result = await window.prints.print({
      pdf,
      printer,
      copies: p.file.copies,
      duplex: p.file.sides === 'double',
      color: p.part.kind === 'color',
      paperSize: p.file.paper_size,
      label: `#${job.token} ${p.file.original_name} (${p.part.kind === 'bw' ? 'B&W' : 'Colour'})`,
    });
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error });
      return false;
    }
    return true;
  }

  async function print(list: PartRef[]) {
    setMessage(null);
    if (['new', 'opened', 'ready'].includes(status.current) && !(await move('printing'))) return;
    const done = new Set(printed);
    for (const p of list) {
      setPrinting(p.key);
      const ok = await printOne(p).catch((e: Error) => {
        setMessage({ kind: 'error', text: e.message });
        return false;
      });
      if (!ok) break;
      done.add(p.key);
      setPrinted(new Set(done));
    }
    setPrinting(null);
    if (parts.every((p) => done.has(p.key))) {
      if (await move('ready')) setMessage({ kind: 'info', text: 'Sent to the printer. The customer now sees “Ready”.' });
    }
  }

  async function markPaid(paid: boolean) {
    setBusy(true);
    const err = await setPaid(job, paid);
    setBusy(false);
    if (err) setMessage({ kind: 'error', text: err });
    else onChanged();
  }

  async function finish() {
    setBusy(true);
    await move('done', { paid_at_counter: true });
    setBusy(false);
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[360px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 xl:w-[440px]">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <header className="flex items-start gap-4">
            <div className="rounded-2xl bg-accent px-4 py-2 text-center text-white">
              <div className="text-xs text-white/70">Token</div>
              <div className="text-4xl font-bold tabular-nums" data-testid="job-token">#{job.token}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="selectable truncate text-xl font-semibold">{job.customer_name || 'Customer'}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`} data-testid="job-status">
                  {STATUS_LABEL[job.status]}
                </span>
              </div>
              <p className="text-sm text-slate-500">Sent at {timeOf(job.submitted_at)}</p>
              <p className="mt-1 text-2xl font-semibold">
                {job.total_paise != null ? formatPaise(job.total_paise) : '–'}
                <span className={`ml-2 align-middle text-sm font-medium ${job.paid_at_counter ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {job.paid_at_counter ? 'Paid' : 'To pay at counter'}
                </span>
              </p>
            </div>
          </header>

          {job.note && (
            <p className="selectable rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              <span className="font-semibold">Note: </span>
              {job.note}
            </p>
          )}
          {job.status === 'failed' && <ErrorNote>The print files could not be prepared{job.error ? `: ${job.error}` : '.'}</ErrorNote>}
          {missingSaved.length > 0 && (
            <ErrorNote>The saved {missingSaved.map((k) => (k === 'bw' ? 'B&W' : 'colour')).join(' and ')} printer is not connected. Using {fallback ?? 'none'}.</ErrorNote>
          )}

          <ol className="space-y-3">
            {job.job_files.map((file, fi) => (
              <li key={file.id} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <p className="selectable min-w-0 font-medium break-words">
                    <span className="mr-1 text-slate-500">{fi + 1}.</span>
                    {file.original_name}
                  </p>
                  {file.price_paise != null && <span className="shrink-0 text-sm text-slate-500">{formatPaise(file.price_paise)}</span>}
                </div>
                {attentionChips(file).length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Check before printing" data-testid="attention-chips">
                    {attentionChips(file).map((c) => (
                      <li key={c.label} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${c.tone}`}>{c.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">Plain print: all pages, B&W, 1 copy, one side, A4</p>
                )}
                <dl className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-500">Pages</dt>
                  <dd>{pagesLabel(file)}</dd>
                  <dt className="text-slate-500">Colour</dt>
                  <dd>{colourLabel(file)}</dd>
                  <dt className="text-slate-500">Copies</dt>
                  <dd>{file.copies}</dd>
                  <dt className="text-slate-500">Sides</dt>
                  <dd>{file.sides === 'double' ? 'Both sides' : 'One side'}</dd>
                  <dt className="text-slate-500">Paper</dt>
                  <dd>{file.paper_size}</dd>
                </dl>
                <ul className="mt-3 space-y-2">
                  {file.print_parts.map((part, i) => {
                    const key = `${file.id}:${i}`;
                    const isCurrent = current?.key === key;
                    return (
                      <li key={key} className={`rounded-lg p-2 ring-1 ${isCurrent ? 'bg-accent-soft ring-2 ring-accent' : 'ring-slate-200'}`}>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setSelected(key)} className="min-w-0 flex-1 text-left">
                            <span className="block text-sm font-medium">{partTitle(part)}</span>
                            <span className="block truncate text-xs text-slate-500">→ {printerFor(part.kind) ?? 'no printer'}</span>
                          </button>
                          {printed.has(key) && <span className="text-sm font-medium text-emerald-700">✓ Sent</span>}
                          {!terminal && (
                            <Button size="sm" disabled={printing !== null} onClick={() => void print([{ key, file, part }])}>
                              {printing === key ? <Spinner /> : 'Print'}
                            </Button>
                          )}
                        </div>
                        {part.kind === 'bw' && file.print_parts.some((p) => p.kind === 'color') && (
                          <p className="mt-1 text-xs text-slate-500">Split order: merge with the colour pages in page order.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>

          {printers.length > 1 && !terminal && (
            <details className="rounded-xl bg-white p-4 text-sm ring-1 ring-slate-200">
              <summary className="cursor-pointer font-medium">Use a different printer for this order</summary>
              {(['bw', 'color'] as const).map((kind) => (
                <label key={kind} className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-slate-600">{kind === 'bw' ? 'B&W parts' : 'Colour parts'}</span>
                  <select
                    className="h-9 max-w-[240px] rounded-lg border border-slate-300 bg-white px-2"
                    value={printerFor(kind) ?? ''}
                    onChange={(e) => setOverride((o) => ({ ...o, [kind]: e.target.value }))}
                  >
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>{p.displayName}</option>
                    ))}
                  </select>
                </label>
              ))}
            </details>
          )}

          {message && (message.kind === 'error' ? <ErrorNote>{message.text}</ErrorNote> : (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{message.text}</p>
          ))}
        </div>

        <footer className="space-y-1 border-t border-slate-200 bg-white p-4">
          {/* one big button for the next step: print, then hand over */}
          {!terminal && job.status !== 'ready' && (
            <Button variant="primary" size="lg" className="w-full" disabled={printing !== null || parts.length === 0} onClick={() => void print(parts)} data-testid="print-all">
              {printing ? <><Spinner /> Printing…</> : parts.length > 1 ? `Print all (${parts.length} parts)` : 'Print'}
            </Button>
          )}
          {job.status === 'ready' && (
            <Button variant="success" size="lg" className="w-full" disabled={busy} onClick={() => void finish()} data-testid="finish">
              {job.paid_at_counter ? 'Collected' : `Paid ${job.total_paise != null ? formatPaise(job.total_paise) : ''} & collected`}
            </Button>
          )}
          {!terminal && (
            <div className="flex flex-wrap justify-center">
              {job.status === 'ready' ? (
                <Button size="sm" variant="ghost" disabled={printing !== null} onClick={() => void print(parts)}>Print again</Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy || printing !== null} onClick={() => void move('ready')}>Mark ready</Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void markPaid(!job.paid_at_counter)}>
                {job.paid_at_counter ? 'Undo paid' : 'Mark paid'}
              </Button>
              {job.status !== 'ready' && (
                <Button size="sm" variant="ghost" disabled={busy || printing !== null} onClick={() => void finish()} data-testid="finish">
                  {job.paid_at_counter ? 'Collected' : 'Paid & collected'}
                </Button>
              )}
            </div>
          )}
          {job.status === 'done' && <p className="text-center text-sm text-slate-500">Collected at {timeOf(job.done_at)}. Files are deleted automatically.</p>}
        </footer>
      </div>

      <div className="min-w-0 flex-1">
        {filesGone ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-slate-600" data-testid="files-gone">
            <p className="text-lg font-medium">{job.status === 'done' ? 'Files are deleted after collection' : 'This order expired'}</p>
            <p className="text-sm">The customer's files are removed automatically, so there's nothing to preview.</p>
          </div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-slate-700">This file couldn't be loaded. Check the internet connection.</p>
            <p className="text-xs text-slate-500">{loadError}</p>
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        ) : current && bytes ? (
          <PdfViewer bytes={bytes} tags={pageTags(current.file, current.part)} />
        ) : current ? (
          <p className="flex h-full items-center justify-center gap-2 text-slate-600"><Spinner /> Loading file…</p>
        ) : (
          <p className="flex h-full items-center justify-center text-slate-600">This order has no print files.</p>
        )}
      </div>
    </div>
  );
}
