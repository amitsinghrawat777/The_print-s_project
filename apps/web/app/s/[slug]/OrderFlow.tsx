"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILES_PER_JOB,
  PricingError,
  checkUpload,
  formatPaise,
  priceFile,
  roundToRupee,
  type FilePrice,
  type FileView,
  type ShopPublic,
} from "@print/shared";
import { ApiRequestError, api, jobStore, uploadToSignedUrl } from "@/lib/client/api";
import { defaultOptions, shopOptions, toSelection, type FileOptions } from "@/lib/client/order";
import { Spinner, cx } from "@/components/ui";
import { FileCard, type Entry, type Phase } from "./FileCard";

interface JobCreds {
  jobId: string;
  accessToken: string;
}

const POLL_MS = 1500;
let keySeq = 0;
const newKey = () => `f${Date.now().toString(36)}${(keySeq++).toString(36)}`;

function phaseOf(f: FileView): Phase {
  switch (f.status) {
    case "ready":
      return "ready";
    case "rejected":
      return "rejected";
    case "pending_upload":
      return "error";
    default:
      return "processing";
  }
}

function entryFromView(f: FileView): Entry {
  return {
    key: f.id,
    fileId: f.id,
    name: f.name,
    size: f.sizeBytes,
    phase: phaseOf(f),
    progress: 1,
    error: f.status === "pending_upload" ? "Upload was interrupted. Remove it and add it again." : (f.error ?? undefined),
    pageCount: f.pageCount ?? undefined,
    previewUrl: f.previewUrl,
  };
}

export function OrderFlow({ shop }: { shop: ShopPublic }) {
  const router = useRouter();
  const opts = useMemo(() => shopOptions(shop.rates), [shop.rates]);

  const [job, setJob] = useState<JobCreds | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [options, setOptions] = useState<Record<string, FileOptions>>({});
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const jobPromise = useRef<Promise<JobCreds> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = useCallback((key: string, update: Partial<Entry>) => {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...update } : e)));
  }, []);

  // Give every ready file default options once.
  useEffect(() => {
    setOptions((current) => {
      let changed = false;
      const next = { ...current };
      for (const e of entries) {
        if (e.phase === "ready" && !next[e.key]) {
          next[e.key] = defaultOptions(opts);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [entries, opts]);

  // Resume a draft order from this browser (e.g. after a refresh).
  useEffect(() => {
    const saved = jobStore.draftFor(shop.slug);
    if (!saved) {
      setRestoring(false);
      return;
    }
    api
      .getJob(saved.jobId, saved.accessToken)
      .then((view) => {
        if (view.status !== "draft") {
          jobStore.setDraft(shop.slug, null);
          return;
        }
        const creds = { jobId: saved.jobId, accessToken: saved.accessToken };
        jobPromise.current = Promise.resolve(creds);
        setJob(creds);
        setEntries(view.files.map(entryFromView));
      })
      .catch(() => jobStore.setDraft(shop.slug, null))
      .finally(() => setRestoring(false));
  }, [shop.slug]);

  const ensureJob = useCallback(async (): Promise<JobCreds> => {
    if (!jobPromise.current) {
      jobPromise.current = api
        .createJob(shop.slug)
        .then((r) => {
          const creds = { jobId: r.jobId, accessToken: r.accessToken };
          jobStore.setDraft(shop.slug, { ...creds, savedAt: Date.now() });
          setJob(creds);
          return creds;
        })
        .catch((err) => {
          jobPromise.current = null;
          throw err;
        });
    }
    return jobPromise.current;
  }, [shop.slug]);

  const uploadOne = useCallback(
    async (key: string, file: File) => {
      try {
        const creds = await ensureJob();
        const reg = await api.registerFile(creds.jobId, creds.accessToken, file);
        patch(key, { fileId: reg.fileId });
        await uploadToSignedUrl(reg.uploadUrl, file, reg.contentType, (p) => patch(key, { progress: p }));
        await api.completeFile(creds.jobId, creds.accessToken, reg.fileId);
        patch(key, { phase: "processing", progress: 1 });
      } catch (err) {
        patch(key, {
          phase: "error",
          error: err instanceof ApiRequestError ? err.message : "Upload failed. Please try again.",
        });
      }
    },
    [ensureJob, patch],
  );

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNotice(null);
    const active = entries.filter((e) => e.phase !== "error" && e.phase !== "rejected").length;
    const room = MAX_FILES_PER_JOB - active;
    const picked = [...files];
    if (picked.length > room) {
      setNotice(`You can add up to ${MAX_FILES_PER_JOB} files per order.`);
    }
    const added: Entry[] = [];
    for (const file of picked.slice(0, Math.max(0, room))) {
      const check = checkUpload(file.name, file.size);
      const entry: Entry = {
        key: newKey(),
        name: file.name,
        size: file.size,
        phase: check.ok ? "uploading" : "error",
        progress: 0,
        error: check.ok ? undefined : check.error,
      };
      added.push(entry);
      if (check.ok) void uploadOne(entry.key, file);
    }
    setEntries((list) => [...list, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  // Poll while the server is still checking files.
  const waiting = entries.some((e) => e.phase === "processing");
  useEffect(() => {
    if (!job || !waiting) return;
    const timer = setInterval(async () => {
      try {
        const view = await api.getJob(job.jobId, job.accessToken);
        if (view.status !== "draft") {
          router.push(`/j/${job.jobId}`);
          return;
        }
        setEntries((list) =>
          list.map((e) => {
            const f = e.fileId ? view.files.find((v) => v.id === e.fileId) : undefined;
            if (!f || e.phase === "uploading") return e;
            if (f.status === "ready" || f.status === "rejected") {
              return {
                ...e,
                phase: phaseOf(f),
                pageCount: f.pageCount ?? undefined,
                previewUrl: f.previewUrl,
                error: f.error ?? undefined,
              };
            }
            return e;
          }),
        );
      } catch {
        /* transient; try again next tick */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job, waiting, router]);

  const remove = async (entry: Entry) => {
    setEntries((list) => list.filter((e) => e.key !== entry.key));
    setOptions(({ [entry.key]: _removed, ...rest }) => rest);
    if (entry.fileId && job) {
      await api.deleteFile(job.jobId, job.accessToken, entry.fileId).catch(() => undefined);
    }
  };

  const move = (key: string, dir: -1 | 1) =>
    setEntries((list) => {
      const i = list.findIndex((e) => e.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  // ---- Live pricing (same function the server uses) ----
  const readyEntries = entries.filter((e) => e.phase === "ready" && e.pageCount);
  const computed = readyEntries.map((e) => {
    const o = options[e.key];
    if (!o) return { key: e.key, selection: undefined, price: undefined };
    const selection = toSelection(o, e.pageCount!);
    if (!selection.ok) {
      return { key: e.key, selection, price: { ok: false as const, error: selection.error } };
    }
    try {
      return { key: e.key, selection, price: { ok: true as const, value: priceFile(selection.selection, shop.rates) } };
    } catch (err) {
      const msg = err instanceof PricingError ? err.message : "Can't price this file";
      return { key: e.key, selection, price: { ok: false as const, error: msg } };
    }
  });
  const byKey = new Map(computed.map((c) => [c.key, c]));
  const allPriced = computed.length > 0 && computed.every((c) => c.price?.ok);
  const subtotal = computed.reduce(
    (sum, c) => sum + (c.price?.ok ? (c.price.value as FilePrice).totalPaise : 0),
    0,
  );
  const total = roundToRupee(subtotal);
  const busy = entries.some((e) => e.phase === "uploading" || e.phase === "processing");
  const hasFailed = entries.some((e) => e.phase === "error");
  const canSubmit =
    !!job && allPriced && !busy && !hasFailed && name.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!job || !canSubmit) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await api.submit(job.jobId, job.accessToken, {
        customerName: name.trim(),
        note: note.trim() || undefined,
        clientTotalPaise: total,
        files: readyEntries.map((e, position) => {
          const c = byKey.get(e.key)!;
          if (!c.selection?.ok) throw new Error("invalid selection");
          return { fileId: e.fileId!, position, ...c.selection.selection, pageSequence: [...c.selection.selection.pageSequence], colorPages: [...c.selection.selection.colorPages] };
        }),
      });
      jobStore.setDraft(shop.slug, null);
      router.push(`/j/${job.jobId}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "JOB_NOT_DRAFT") {
        // Already sent (e.g. a double tap or a retry after a network blip).
        jobStore.setDraft(shop.slug, null);
        router.push(`/j/${job.jobId}`);
        return;
      }
      if (err instanceof ApiRequestError && err.code === "PRICE_CHANGED") {
        setNotice("The shop just updated its prices — please check the new total and send again.");
        router.refresh();
      } else {
        setNotice(err instanceof ApiRequestError ? err.message : "Couldn't send. Please try again.");
      }
      setSubmitting(false);
    }
  };

  if (restoring) {
    return (
      <p className="flex items-center gap-2 text-gray-500">
        <Spinner /> Loading…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        id="file-input"
        onChange={(e) => addFiles(e.target.files)}
      />

      {entries.length === 0 ? (
        <label
          htmlFor="file-input"
          className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-brand-500/50 bg-white px-6 py-10 text-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-600">↑</span>
          <span className="mt-3 text-lg font-semibold">Upload your files</span>
          <span className="mt-1 text-sm text-gray-500">PDF, Word, PowerPoint, Excel or photos · up to 25 MB each</span>
        </label>
      ) : (
        <ul className="space-y-3">
          {entries.map((e, i) => {
            const c = byKey.get(e.key);
            return (
              <FileCard
                key={e.key}
                entry={e}
                index={i}
                count={entries.length}
                options={options[e.key]}
                shop={opts}
                selection={c?.selection}
                price={c?.price}
                onChange={(next) => setOptions((o) => ({ ...o, [e.key]: next }))}
                onRemove={() => void remove(e)}
                onMove={(dir) => move(e.key, dir)}
              />
            );
          })}
        </ul>
      )}

      {entries.length > 0 && entries.length < MAX_FILES_PER_JOB && (
        <label
          htmlFor="file-input"
          className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-white text-sm font-medium text-brand-700 ring-1 ring-gray-200"
        >
          + Add another file
        </label>
      )}

      {readyEntries.length > 0 && (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">Your name</span>
            <input
              type="text"
              autoComplete="given-name"
              maxLength={40}
              placeholder="So the shop can call you"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">Note for the shop (optional)</span>
            <input
              type="text"
              maxLength={300}
              placeholder="e.g. staple please"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-base"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="text-xs text-gray-500">Your files are deleted automatically after printing.</p>
        </section>
      )}

      {notice && (
        <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {notice}
        </p>
      )}

      {entries.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">Total · pay at counter</p>
              <p className="text-2xl font-bold leading-tight">{allPriced ? formatPaise(total) : "—"}</p>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={cx(
                "flex min-h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold text-white",
                canSubmit ? "bg-brand-600 active:bg-brand-700" : "bg-gray-300",
              )}
            >
              {submitting && <Spinner />}
              {busy ? "Uploading…" : "Send to shop"}
            </button>
          </div>
          {!busy && allPriced && !name.trim() && (
            <p className="mx-auto max-w-md px-4 pb-2 text-xs text-gray-500">Enter your name to send.</p>
          )}
          {hasFailed && (
            <p className="mx-auto max-w-md px-4 pb-2 text-xs text-red-600">Remove the files that failed to send.</p>
          )}
        </div>
      )}
    </div>
  );
}
