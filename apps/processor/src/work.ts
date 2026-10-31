import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import {
  planPrintParts,
  STORAGE_BUCKET,
  type MixedColorMode,
  type PrintPart,
  type Sides,
} from '@prints/shared';
import type { Env } from './env';
import { detectFileType, extractPages, imageToPdf, inspectPdf, officeToPdf, RejectedFileError } from './pdf';

export interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const GENERIC_FILE_ERROR = "We couldn't process this file. Please try uploading it again.";

export function createWorker(env: Env, log: Logger) {
  const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = () => db.storage.from(STORAGE_BUCKET);

  async function download(path: string): Promise<Uint8Array> {
    const { data, error } = await bucket().download(path);
    if (error || !data) throw new Error(`Download of ${path} failed: ${error?.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async function uploadPdf(path: string, bytes: Uint8Array) {
    const { error } = await bucket().upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`Upload of ${path} failed: ${error.message}`);
  }

  /**
   * Validates an uploaded file, converts it to PDF if needed and records its
   * page count. Safe to call more than once for the same file.
   */
  async function processFile(fileId: string): Promise<void> {
    const staleProcessing = new Date(Date.now() - 3 * 60_000).toISOString();
    const { data: file, error } = await db
      .from('job_files')
      .update({ status: 'processing', error: null })
      .eq('id', fileId)
      .or(`status.eq.uploaded,and(status.eq.processing,updated_at.lt.${staleProcessing})`)
      .select('id, job_id, shop_id, ext, original_path')
      .maybeSingle();
    if (error) throw error;
    if (!file) return; // already processed, being processed, or deleted

    try {
      const original = await download(file.original_path);
      const type = await detectFileType(original, file.ext);

      let pdf: Uint8Array;
      let pdfPath: string;
      if (type.kind === 'pdf') {
        pdf = original;
        pdfPath = file.original_path;
      } else {
        pdf =
          type.kind === 'image'
            ? await imageToPdf(original, type.ext as 'jpg' | 'png')
            : await officeToPdf(env.GOTENBERG_URL, original, type.ext);
        pdfPath = `${file.shop_id}/${file.job_id}/pdf/${file.id}.pdf`;
      }

      const { pageCount } = await inspectPdf(pdf);
      if (pdfPath !== file.original_path) await uploadPdf(pdfPath, pdf);

      await db
        .from('job_files')
        .update({
          status: 'ready',
          pdf_path: pdfPath,
          page_count: pageCount,
          mime: type.mime,
          size_bytes: original.byteLength,
        })
        .eq('id', file.id)
        .eq('status', 'processing');
      log.info({ fileId, kind: type.kind, pageCount }, 'file ready');
    } catch (err) {
      const rejected = err instanceof RejectedFileError;
      if (!rejected) log.error({ fileId, err }, 'file processing failed');
      await db
        .from('job_files')
        .update({ status: 'rejected', error: rejected ? err.message : GENERIC_FILE_ERROR })
        .eq('id', file.id)
        .eq('status', 'processing');
    }
  }

  /**
   * Builds the print-ready PDFs for a submitted job (only the chosen pages, in
   * order, split by colour where the shop wants that) and puts it in the
   * shop's queue. Safe to call more than once.
   */
  async function buildJob(jobId: string): Promise<void> {
    const { data: job, error } = await db
      .from('jobs')
      .select('id, shop_id, status, shops(mixed_color_mode)')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    if (!job || job.status !== 'building') return;
    const mode = (job.shops as unknown as { mixed_color_mode: MixedColorMode }).mixed_color_mode;

    try {
      const { data: files, error: filesError } = await db
        .from('job_files')
        .select('id, pdf_path, page_sequence, color_pages, copies, sides')
        .eq('job_id', jobId)
        .eq('status', 'ready')
        .order('position');
      if (filesError) throw filesError;
      if (!files.length) throw new Error('Job has no ready files');

      for (const file of files) {
        const source = await PDFDocument.load(await download(file.pdf_path!), { updateMetadata: false });
        const plans = planPrintParts(
          {
            pageSequence: file.page_sequence as number[],
            colorPages: file.color_pages as number[],
            copies: file.copies as number,
            sides: file.sides as Sides,
          },
          mode,
        );
        const parts: PrintPart[] = [];
        for (const [index, plan] of plans.entries()) {
          const path = `${job.shop_id}/${job.id}/print/${file.id}-${index + 1}-${plan.kind}.pdf`;
          await uploadPdf(path, await extractPages(source, plan.pages));
          parts.push({ ...plan, path });
        }
        const { error: updateError } = await db.from('job_files').update({ print_parts: parts }).eq('id', file.id);
        if (updateError) throw updateError;
      }

      await db.from('jobs').update({ status: 'new', error: null }).eq('id', jobId).eq('status', 'building');
      log.info({ jobId, files: files.length }, 'job ready for the shop');
    } catch (err) {
      log.error({ jobId, err }, 'job build failed');
      await db
        .from('jobs')
        .update({ status: 'failed', error: (err as Error).message })
        .eq('id', jobId)
        .eq('status', 'building');
    }
  }

  async function removeFolder(prefix: string) {
    for (const folder of ['original', 'pdf', 'print']) {
      const { data, error } = await bucket().list(`${prefix}/${folder}`, { limit: 1000 });
      if (error) throw error;
      if (data.length) {
        const { error: removeError } = await bucket().remove(data.map((o) => `${prefix}/${folder}/${o.name}`));
        if (removeError) throw removeError;
      }
    }
  }

  /** Deletes files of finished, abandoned and old jobs (see jobs_to_purge()). */
  async function purgeOldJobs(): Promise<number> {
    const { data: jobs, error } = await db.rpc('jobs_to_purge', { p_limit: 50 });
    if (error) throw error;
    const purged: string[] = [];
    for (const job of jobs as { id: string; shop_id: string }[]) {
      try {
        await removeFolder(`${job.shop_id}/${job.id}`);
        purged.push(job.id);
      } catch (err) {
        log.error({ jobId: job.id, err }, 'purge failed');
      }
    }
    if (purged.length) {
      const { error: markError } = await db.rpc('mark_jobs_purged', { p_job_ids: purged });
      if (markError) throw markError;
      log.info({ count: purged.length }, 'purged job files');
    }
    return purged.length;
  }

  /** Picks up work that was missed, e.g. if the processor restarted mid-job. */
  async function retryStuckWork(): Promise<void> {
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const threeMinutesAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();

    const { data: files } = await db
      .from('job_files')
      .select('id')
      .or(`and(status.eq.uploaded,updated_at.lt.${minuteAgo}),and(status.eq.processing,updated_at.lt.${threeMinutesAgo})`)
      .limit(20);
    for (const f of files ?? []) await processFile(f.id);

    const { data: jobs } = await db
      .from('jobs')
      .select('id')
      .eq('status', 'building')
      .lt('updated_at', twoMinutesAgo)
      .limit(20);
    for (const j of jobs ?? []) await buildJob(j.id);
  }

  return { processFile, buildJob, purgeOldJobs, retryStuckWork };
}

export type Worker = ReturnType<typeof createWorker>;
