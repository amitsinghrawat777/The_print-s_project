'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCEPT_ATTRIBUTE,
  allPages,
  fileTypeFromName,
  formatPaise,
  MAX_CUSTOMER_NAME,
  MAX_FILE_BYTES,
  MAX_FILES_PER_JOB,
  MAX_NOTE,
  priceFile,
  priceJob,
  PricingError,
  type FilePrice,
} from '@prints/shared';
import { api, ApiRequestError, uploadFile } from '@/lib/client/api';
import { saveJobToken } from '@/lib/client/jobTokens';
import type { JobFileView, PublicShop } from '@/lib/types';
import { Spinner } from '../ui';
import { describePrice, FileCard } from './FileCard';
import { defaultChoices, toPrintOptions, type FileChoices, type OrderFile } from './model';

interface Draft {
  jobId: string;
  token: string;
}

export function OrderFlow({ shop: initialShop }: { shop: PublicShop }) {
  const router = useRouter();
  const [shop, setShop] = useState(initialShop);
  const [files, setFiles] = useState<OrderFile[]>([]);
  const [step, setStep] = useState<'files' | 'review'>('files');
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const draftRef = useRef<Promise<Draft> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchFile = useCallback((key: string, patch: Partial<OrderFile> | ((f: OrderFile) => Partial<OrderFile>)) => {
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f)));
  }, []);

  /** The draft order is created when the first file is added. */
  const draft = useCallback(() => {
    draftRef.current ??= api.createJob(shop.slug).then(
      ({ jobId, accessToken }) => ({ jobId, token: accessToken }),
      (error) => {
        draftRef.current = null;
        throw error;
      },
    );
    return draftRef.current;
  }, [shop.slug]);

  async function addFiles(picked: File[]) {
    setNotice(null);
    const room = MAX_FILES_PER_JOB - files.filter((f) => f.phase !== 'rejected').length;
    if (picked.length > room) setNotice(`You can add up to ${MAX_FILES_PER_JOB} files to one order.`);

    const added: OrderFile[] = picked.slice(0, Math.max(0, room)).map((file) => {
      const problem = !fileTypeFromName(file.name)
        ? "This file type can't be printed. Use PDF, Word, PowerPoint, Excel, JPG or PNG."
        : file.size > MAX_FILE_BYTES
          ? `This file is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_FILE_BYTES / 1048576} MB.`
          : file.size === 0
            ? 'This file is empty.'
            : null;
      return {
        key: crypto.randomUUID(),
        serverId: null,
        name: file.name,
        size: file.size,
        local: file,
        phase: problem ? 'rejected' : 'uploading',
        progress: 0,
        error: problem,
        pageCount: null,
        previewUrl: null,
        choices: defaultChoices(shop),
      };
    });
    setFiles((list) => [...list, ...added]);
    await Promise.all(added.filter((f) => f.phase === 'uploading').map(upload));
  }

  async function upload(file: OrderFile) {
    let serverId: string | null = null;
    try {
      const { jobId, token } = await draft();
      const registered = await api.registerFile(jobId, token, { name: file.name, size: file.size });
      serverId = registered.file.id;
      patchFile(file.key, { serverId });
      await uploadFile(registered.upload.url, file.local!, registered.upload.contentType, (progress) =>
        patchFile(file.key, { progress }),
      );
      patchFile(file.key, { phase: 'processing', progress: 1 });
      mergeServerFile(file.key, await api.completeFile(jobId, token, serverId));
    } catch (error) {
      // a half-uploaded file would block sending the order, so drop it on the server too
      if (serverId) {
        const { jobId, token } = await draft();
        await api.deleteFile(jobId, token, serverId).catch(() => {});
      }
      patchFile(file.key, {
        serverId: null,
        phase: 'rejected',
        error: error instanceof Error ? error.message : 'Upload failed. Please try again.',
      });
    }
  }

  const mergeServerFile = (key: string, server: JobFileView) => patchFile(key, (f) => serverPatch(f, server));

  // While files are being converted, poll the order for page counts.
  const processing = files.some((f) => f.phase === 'processing');
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(async () => {
      try {
        const { jobId, token } = await draft();
        const job = await api.job(jobId, token);
        setFiles((list) =>
          list.map((f) => {
            const server = job.files.find((s) => s.id === f.serverId);
            return server && f.phase === 'processing' ? { ...f, ...serverPatch(f, server) } : f;
          }),
        );
      } catch {
        // try again on the next tick
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [processing, draft]);

  async function removeFile(file: OrderFile) {
    setFiles((list) => list.filter((f) => f.key !== file.key));
    if (file.serverId) {
      const { jobId, token } = await draft();
      await api.deleteFile(jobId, token, file.serverId).catch(() => {});
    }
  }

  function moveFile(index: number, direction: -1 | 1) {
    setFiles((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + direction, 0, moved!);
      return next;
    });
  }

  const ready = files.filter((f) => f.phase === 'ready');
  const pricing = livePrice(ready, shop);

  const busy = files.some((f) => f.phase === 'uploading' || f.phase === 'processing');
  const canContinue = !busy && pricing.job !== null;

  async function send() {
    if (!pricing.job || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const { jobId, token } = await draft();
      await api.submit(jobId, token, {
        customerName: name.trim(),
        note: note.trim(),
        files: ready.map((f) => {
          const o = toPrintOptions(f);
          return { ...o, fileId: f.serverId!, pageSequence: [...o.pageSequence], colorPages: [...o.colorPages] };
        }),
        clientTotalPaise: pricing.job.totalPaise,
      });
      saveJobToken(jobId, token);
      router.push(`/j/${jobId}`);
    } catch (error) {
      setSending(false);
      if (error instanceof ApiRequestError && error.code === 'PRICE_CHANGED') {
        setShop(await api.shop(shop.slug).catch(() => shop));
        setNotice('The shop just updated its prices. Please check the new total before sending.');
      } else if (error instanceof ApiRequestError && error.code === 'NOT_EDITABLE') {
        const { jobId, token } = await draft();
        saveJobToken(jobId, token);
        router.push(`/j/${jobId}`);
      } else {
        setNotice(error instanceof Error ? error.message : 'Could not send your order. Please try again.');
      }
    }
  }

  if (!shop.isAccepting) {
    return (
      <Banner tone="amber">
        <strong>{shop.name}</strong> isn&apos;t taking online orders right now. Please ask at the counter.
      </Banner>
    );
  }

  if (step === 'review' && pricing.job) {
    const job = pricing.job;
    return (
      <form
        className="space-y-5 pb-32"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button type="button" onClick={() => setStep('files')} className="text-sm font-medium text-blue-700">
          ← Change files or options
        </button>
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Your order</h2>
          <ul className="divide-y divide-slate-100">
            {ready.map((f, i) => (
              <li key={f.key} className="flex justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {i + 1}. {f.name}
                  </p>
                  <p className="text-slate-500">
                    {f.choices.rangeText ? `Pages ${f.choices.rangeText} · ` : ''}
                    {describePrice(job.files[i]!, f.choices.sides)}
                    {f.choices.sides === 'double' ? ' (both sides)' : ''} · {f.choices.paperSize}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">{formatPaise(job.files[i]!.pricePaise)}</span>
              </li>
            ))}
            {job.roundingPaise !== 0 && (
              <li className="flex justify-between px-4 py-2 text-sm text-slate-500">
                <span>Rounding</span>
                <span className="tabular-nums">
                  {job.roundingPaise > 0 ? '+' : '−'}
                  {formatPaise(Math.abs(job.roundingPaise))}
                </span>
              </li>
            )}
            <li className="flex justify-between px-4 py-3 text-base font-semibold">
              <span>Total, pay at the counter</span>
              <span className="tabular-nums">{formatPaise(job.totalPaise)}</span>
            </li>
          </ul>
        </section>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">Your name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_CUSTOMER_NAME}
            autoComplete="given-name"
            placeholder="So the shop knows whose order it is"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Note for the shop <span className="font-normal text-slate-500">(optional)</span>
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE}
            rows={2}
            placeholder="e.g. Staple each copy"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>

        {notice && <Banner tone="red">{notice}</Banner>}
        <p className="text-xs text-slate-500">Your files are deleted automatically after printing.</p>

        <BottomBar total={job.totalPaise}>
          <button
            type="submit"
            disabled={sending || !name.trim()}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:bg-slate-300"
          >
            {sending && <Spinner />} {sending ? 'Sending…' : 'Send to shop'}
          </button>
        </BottomBar>
      </form>
    );
  }

  return (
    <div className="space-y-4 pb-32">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length) void addFiles(picked);
        }}
      />

      {files.map((file, i) => (
        <FileCard
          key={file.key}
          file={file}
          index={i}
          count={files.length}
          shop={shop}
          price={file.choices.rangeError ? null : (pricing.perFile.get(file.key) ?? null)}
          onChange={(choices: FileChoices) => patchFile(file.key, { choices })}
          onRemove={() => void removeFile(file)}
          onMove={(direction) => moveFile(i, direction)}
        />
      ))}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/60 text-blue-800 transition hover:bg-blue-50 ${
          files.length ? 'py-5' : 'py-12'
        }`}
      >
        <span className="text-3xl leading-none" aria-hidden>
          +
        </span>
        <span className="font-semibold">{files.length ? 'Add another file' : 'Choose files to print'}</span>
        <span className="text-xs text-blue-700/80">PDF, Word, PowerPoint, Excel, JPG or PNG · up to 25 MB</span>
      </button>

      {notice && <Banner tone="amber">{notice}</Banner>}

      {files.length === 0 && (
        <ol className="space-y-2.5 px-1 pt-2 text-sm text-slate-600">
          {['Add your files', 'Choose pages, colour and copies, and see the price', 'Send, then pay and collect at the counter with your token'].map(
            (text, i) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                  {i + 1}
                </span>
                {text}
              </li>
            ),
          )}
          <li className="pt-2 text-xs text-slate-500">
            No login needed. Your files go only to this shop and are deleted automatically after printing.
          </li>
        </ol>
      )}

      {files.length > 0 && (
        <BottomBar total={pricing.job?.totalPaise ?? null} busy={busy}>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => {
              setNotice(null);
              setStep('review');
              window.scrollTo({ top: 0 });
            }}
            className="min-h-12 flex-1 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:bg-slate-300"
          >
            Continue
          </button>
        </BottomBar>
      )}
    </div>
  );
}

/** How a file's local state changes when the server reports on it. */
function serverPatch(file: OrderFile, server: JobFileView): Partial<OrderFile> {
  if (server.status === 'ready' && file.phase !== 'ready') {
    return {
      phase: 'ready',
      pageCount: server.pageCount,
      previewUrl: server.previewUrl,
      choices: { ...file.choices, pageSequence: allPages(server.pageCount ?? 1) },
    };
  }
  if (server.status === 'rejected') return { phase: 'rejected', error: server.error };
  return {};
}

/** The same pricing the server does, run on every change. */
function livePrice(ready: OrderFile[], shop: PublicShop) {
  const perFile = new Map<string, FilePrice | string>();
  for (const f of ready) {
    if (f.choices.rangeError) continue;
    try {
      perFile.set(f.key, priceFile(toPrintOptions(f), shop.rates));
    } catch (error) {
      perFile.set(f.key, error instanceof PricingError ? error.message : 'Price unavailable');
    }
  }
  const valid = ready.length > 0 && ready.every((f) => typeof perFile.get(f.key) === 'object');
  return { perFile, job: valid ? priceJob(ready.map(toPrintOptions), shop.rates) : null };
}

function BottomBar({ total, busy, children }: { total: number | null; busy?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center gap-4">
        <div className="min-w-20">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-bold tabular-nums" aria-live="polite">
            {busy ? <Spinner className="size-5 text-slate-400" /> : total === null ? '—' : formatPaise(total)}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) {
  const styles = tone === 'red' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900';
  return (
    <p className={`rounded-xl p-3 text-sm ${styles}`} role="alert">
      {children}
    </p>
  );
}
