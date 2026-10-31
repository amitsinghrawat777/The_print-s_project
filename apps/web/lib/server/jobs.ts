import "server-only";
import {
  JOBS_BUCKET,
  JOB_TOKEN_HEADER,
  sha256Hex,
  type FileKind,
  type FileStatus,
  type FileView,
  type JobStatus,
  type JobView,
  type PaperSize,
  type Sides,
} from "@print/shared";
import { db } from "./db";
import { HttpError } from "./http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW_URL_SECONDS = 10 * 60;

export interface JobRow {
  id: string;
  shop_id: string;
  status: JobStatus;
  token: string | null;
  total_paise: number | null;
  customer_name: string | null;
  paid_at_counter: boolean;
  shops: { slug: string; name: string; is_accepting: boolean; duplex_available: boolean };
}

export interface FileRow {
  id: string;
  job_id: string;
  position: number;
  status: FileStatus;
  original_name: string;
  kind: FileKind;
  size_bytes: number;
  page_count: number | null;
  pdf_path: string | null;
  error: string | null;
  page_sequence: number[] | null;
  color_pages: number[] | null;
  copies: number | null;
  sides: Sides | null;
  paper_size: PaperSize | null;
  price_paise: number | null;
}

const JOB_COLUMNS =
  "id, shop_id, status, token, total_paise, customer_name, paid_at_counter, shops(slug, name, is_accepting, duplex_available)";
export const FILE_COLUMNS =
  "id, job_id, position, status, original_name, kind, size_bytes, page_count, pdf_path, error, page_sequence, color_pages, copies, sides, paper_size, price_paise";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Loads a job only if the request carries its secret (X-Job-Token header).
 * Unknown job and wrong secret look the same to the caller (404).
 */
export async function requireJob(req: Request, jobId: string): Promise<JobRow> {
  const token = req.headers.get(JOB_TOKEN_HEADER);
  if (!UUID.test(jobId) || !token || token.length < 32 || token.length > 128) {
    throw new HttpError(404, "Order not found", "NOT_FOUND");
  }
  const [{ data: secret }, { data: job, error }] = await Promise.all([
    db().from("job_secrets").select("access_token_hash").eq("job_id", jobId).maybeSingle(),
    db().from("jobs").select(JOB_COLUMNS).eq("id", jobId).maybeSingle<JobRow>(),
  ]);
  if (error) throw new HttpError(500, "Could not load order");
  if (!secret || !job || !timingSafeEqual(secret.access_token_hash, await sha256Hex(token))) {
    throw new HttpError(404, "Order not found", "NOT_FOUND");
  }
  return job;
}

export function requireDraft(job: JobRow): void {
  if (job.status !== "draft") {
    throw new HttpError(409, "This order was already sent to the shop.", "JOB_NOT_DRAFT");
  }
}

export async function loadFiles(jobId: string): Promise<FileRow[]> {
  const { data, error } = await db()
    .from("job_files")
    .select(FILE_COLUMNS)
    .eq("job_id", jobId)
    .order("position")
    .order("created_at")
    .returns<FileRow[]>();
  if (error) throw new HttpError(500, "Could not load files");
  return data ?? [];
}

export async function buildJobView(job: JobRow): Promise<JobView> {
  const files = await loadFiles(job.id);
  const readyPaths = files.filter((f) => f.status === "ready" && f.pdf_path).map((f) => f.pdf_path!);
  const urls = new Map<string, string>();
  if (readyPaths.length > 0 && job.status !== "expired") {
    const { data } = await db()
      .storage.from(JOBS_BUCKET)
      .createSignedUrls(readyPaths, PREVIEW_URL_SECONDS);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  const view: FileView[] = files.map((f) => ({
    id: f.id,
    name: f.original_name,
    kind: f.kind,
    sizeBytes: f.size_bytes,
    status: f.status,
    pageCount: f.page_count,
    error: f.error,
    previewUrl: f.pdf_path ? (urls.get(f.pdf_path) ?? null) : null,
    selection:
      f.page_sequence && f.copies && f.sides && f.paper_size && f.price_paise !== null
        ? {
            pageSequence: f.page_sequence,
            colorPages: f.color_pages ?? [],
            copies: f.copies,
            sides: f.sides,
            paperSize: f.paper_size,
            pricePaise: f.price_paise,
          }
        : null,
  }));

  return {
    id: job.id,
    status: job.status,
    token: job.token,
    totalPaise: job.total_paise,
    customerName: job.customer_name,
    paidAtCounter: job.paid_at_counter,
    shop: { slug: job.shops.slug, name: job.shops.name },
    files: view,
  };
}
