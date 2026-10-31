/**
 * The processor's three jobs, wired to Supabase:
 *   processFile — validate + normalize one upload, count pages
 *   buildJob    — make the print-ready PDFs for a submitted order
 *   sweep       — expire old jobs, delete their files, retry stuck work
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FastifyBaseLogger } from "fastify";
import { JOBS_BUCKET, storagePaths, type FileKind, type Sides } from "@print/shared";
import { buildPrintFiles, type GreyscaleFn, type PrintMode } from "./build.js";
import { RejectedFileError, normalizeToPdf } from "./convert.js";
import type { WorkQueue } from "./queue.js";

export interface Deps {
  db: SupabaseClient;
  log: FastifyBaseLogger;
  gotenbergUrl: string;
  greyscale: GreyscaleFn;
}

const GENERIC_FILE_ERROR = "We couldn't process this file. Please try uploading it again.";
const STUCK_PROCESSING_MS = 5 * 60_000;
const STUCK_UPLOADED_MS = 60_000;
const STUCK_BUILDING_MS = 2 * 60_000;

interface FileRow {
  id: string;
  job_id: string;
  shop_id: string;
  status: string;
  kind: FileKind;
  ext: string;
  original_path: string;
  pdf_path: string | null;
  page_sequence: number[] | null;
  color_pages: number[] | null;
  copies: number | null;
  sides: Sides | null;
}

async function download(db: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(JOBS_BUCKET).download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function upload(db: SupabaseClient, path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await db.storage
    .from(JOBS_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// processFile
// ---------------------------------------------------------------------------
export async function processFile(deps: Deps, fileId: string): Promise<void> {
  const { db, log } = deps;
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();

  // Claim the file (also re-claims one stuck in `processing` after a crash).
  const { data: file, error } = await db
    .from("job_files")
    .update({ status: "processing", error: null })
    .eq("id", fileId)
    .or(`status.eq.uploaded,and(status.eq.processing,updated_at.lt."${stuckBefore}")`)
    .select("id, job_id, shop_id, status, kind, ext, original_path")
    .maybeSingle<FileRow>();
  if (error) throw new Error(`claim file ${fileId}: ${error.message}`);
  if (!file) {
    log.debug({ fileId }, "file not claimable (already processed or missing)");
    return;
  }

  const finish = async (fields: Record<string, unknown>) => {
    const { error: upErr } = await db.from("job_files").update(fields).eq("id", fileId);
    if (upErr) throw new Error(`update file ${fileId}: ${upErr.message}`);
  };

  try {
    let original: Uint8Array;
    try {
      original = await download(db, file.original_path);
    } catch {
      throw new RejectedFileError("The upload didn't finish. Please upload the file again.");
    }

    const { pdf, pageCount } = await withOneRetry(() =>
      normalizeToPdf(original, file.kind, file.ext, { gotenbergUrl: deps.gotenbergUrl }),
    );

    let pdfPath = file.original_path;
    if (file.kind !== "pdf") {
      pdfPath = storagePaths.pdf(file.shop_id, file.job_id, file.id);
      await upload(db, pdfPath, pdf);
    }
    await finish({ status: "ready", page_count: pageCount, pdf_path: pdfPath, error: null });
    log.info({ fileId, kind: file.kind, pageCount }, "file ready");
  } catch (err) {
    const rejected = err instanceof RejectedFileError;
    if (!rejected) log.error({ err, fileId }, "file processing failed");
    await finish({ status: "rejected", error: rejected ? err.message : GENERIC_FILE_ERROR });
  }
}

/** Retries once on unexpected (non-customer) errors, e.g. a Gotenberg hiccup. */
async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RejectedFileError) throw err;
    await new Promise((r) => setTimeout(r, 1000));
    return fn();
  }
}

// ---------------------------------------------------------------------------
// buildJob
// ---------------------------------------------------------------------------
export async function buildJob(deps: Deps, jobId: string): Promise<void> {
  const { db, log } = deps;

  const { data: job, error } = await db
    .from("jobs")
    .select("id, shop_id, status, shops(mixed_color_mode)")
    .eq("id", jobId)
    .maybeSingle<{
      id: string;
      shop_id: string;
      status: string;
      shops: { mixed_color_mode: PrintMode } | null;
    }>();
  if (error) throw new Error(`load job ${jobId}: ${error.message}`);
  if (!job || job.status !== "building") {
    log.debug({ jobId, status: job?.status }, "job not in building state; skipping");
    return;
  }

  try {
    const { data: files, error: filesErr } = await db
      .from("job_files")
      .select("id, job_id, shop_id, status, kind, ext, original_path, pdf_path, page_sequence, color_pages, copies, sides")
      .eq("job_id", jobId)
      .eq("status", "ready")
      .order("position");
    if (filesErr) throw new Error(`load files: ${filesErr.message}`);
    if (!files || files.length === 0) throw new Error("job has no ready files");

    for (const f of files as FileRow[]) {
      if (!f.pdf_path || !f.page_sequence || !f.copies || !f.sides) {
        throw new Error(`file ${f.id} is missing its print settings`);
      }
      const pdf = await download(db, f.pdf_path);
      const result = await buildPrintFiles(
        pdf,
        {
          pageSequence: f.page_sequence,
          colorPages: f.color_pages ?? [],
          copies: f.copies,
          sides: f.sides,
        },
        job.shops?.mixed_color_mode ?? "split",
        deps.greyscale,
      );
      if (result.greyscaleSkipped) {
        log.warn({ jobId, fileId: f.id }, "greyscale conversion unavailable; B&W pages kept as-is");
      }

      const bwPath = result.bw ? storagePaths.printBw(f.shop_id, f.job_id, f.id) : null;
      const colorPath = result.color ? storagePaths.printColor(f.shop_id, f.job_id, f.id) : null;
      if (result.bw && bwPath) await upload(db, bwPath, result.bw.bytes);
      if (result.color && colorPath) await upload(db, colorPath, result.color.bytes);

      const { error: upErr } = await db
        .from("job_files")
        .update({
          print_mode: result.mode,
          bw_print_path: bwPath,
          bw_print_pages: result.bw?.pages ?? null,
          color_print_path: colorPath,
          color_print_pages: result.color?.pages ?? null,
        })
        .eq("id", f.id);
      if (upErr) throw new Error(`update file ${f.id}: ${upErr.message}`);
    }

    const { error: doneErr } = await db
      .from("jobs")
      .update({ status: "new", error: null })
      .eq("id", jobId)
      .eq("status", "building");
    if (doneErr) throw new Error(`mark job new: ${doneErr.message}`);
    log.info({ jobId, files: files.length }, "job ready for the shop");
  } catch (err) {
    log.error({ err, jobId }, "build failed");
    await db
      .from("jobs")
      .update({ status: "failed", error: (err as Error).message.slice(0, 500) })
      .eq("id", jobId)
      .eq("status", "building");
  }
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

/** Re-queues work that was lost (processor restart, dropped request). */
export async function recoverStuckWork(deps: Deps, queue: WorkQueue): Promise<number> {
  const { db } = deps;
  const now = Date.now();
  let queued = 0;

  const { data: files } = await db
    .from("job_files")
    .select("id")
    .or(
      `and(status.eq.uploaded,updated_at.lt."${new Date(now - STUCK_UPLOADED_MS).toISOString()}"),` +
        `and(status.eq.processing,updated_at.lt."${new Date(now - STUCK_PROCESSING_MS).toISOString()}")`,
    )
    .limit(50);
  for (const f of files ?? []) {
    if (queue.push(`file:${f.id}`, () => processFile(deps, f.id))) queued++;
  }

  const { data: jobs } = await db
    .from("jobs")
    .select("id")
    .eq("status", "building")
    .lt("updated_at", new Date(now - STUCK_BUILDING_MS).toISOString())
    .limit(50);
  for (const j of jobs ?? []) {
    if (queue.push(`job:${j.id}`, () => buildJob(deps, j.id))) queued++;
  }
  return queued;
}

/** Expires old jobs and deletes their files from storage. */
export async function cleanup(deps: Deps): Promise<{ expired: number; purged: number }> {
  const { db, log } = deps;
  const { data: expired, error } = await db.rpc("expire_jobs");
  if (error) throw new Error(`expire_jobs: ${error.message}`);

  const { data: jobs, error: listErr } = await db
    .from("jobs")
    .select("id, shop_id")
    .eq("status", "expired")
    .is("purged_at", null)
    .limit(200);
  if (listErr) throw new Error(`list expired: ${listErr.message}`);

  let purged = 0;
  for (const job of jobs ?? []) {
    try {
      const prefix = storagePaths.jobPrefix(job.shop_id, job.id);
      const paths: string[] = [];
      for (const folder of ["original", "pdf", "print"]) {
        const { data: objects, error: lsErr } = await db.storage
          .from(JOBS_BUCKET)
          .list(`${prefix}/${folder}`, { limit: 1000 });
        if (lsErr) throw new Error(lsErr.message);
        for (const o of objects ?? []) paths.push(`${prefix}/${folder}/${o.name}`);
      }
      if (paths.length > 0) {
        const { error: rmErr } = await db.storage.from(JOBS_BUCKET).remove(paths);
        if (rmErr) throw new Error(rmErr.message);
      }
      await db.from("jobs").update({ purged_at: new Date().toISOString() }).eq("id", job.id);
      purged++;
    } catch (err) {
      log.error({ err, jobId: job.id }, "purge failed; will retry next sweep");
    }
  }
  if ((expired as number) > 0 || purged > 0) log.info({ expired, purged }, "cleanup");
  return { expired: (expired as number) ?? 0, purged };
}
