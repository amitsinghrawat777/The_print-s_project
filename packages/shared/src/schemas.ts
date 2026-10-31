/** Request bodies and response shapes of the public API (apps/web/app/api). */
import { z } from "zod";
import { MAX_FILE_BYTES, MAX_FILES_PER_JOB } from "./files.js";
import { MAX_SEQUENCE_LENGTH } from "./pageRange.js";
import { MAX_COPIES, type RateRow } from "./pricing.js";
import type { FileStatus, JobStatus } from "./status.js";
import { PAPER_SIZES, SIDES, type PaperSize, type Sides } from "./types.js";
import type { FileKind } from "./files.js";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const CreateJobBody = z.object({
  slug: z.string().regex(SLUG_PATTERN, "Invalid shop link"),
});
export type CreateJobBody = z.infer<typeof CreateJobBody>;

export const RegisterFileBody = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  mime: z.string().max(200).optional(),
});
export type RegisterFileBody = z.infer<typeof RegisterFileBody>;

const PageNumber = z.number().int().min(1);

export const FileSelectionBody = z.object({
  fileId: z.uuid(),
  position: z.number().int().min(0).max(MAX_FILES_PER_JOB - 1),
  pageSequence: z.array(PageNumber).min(1).max(MAX_SEQUENCE_LENGTH),
  colorPages: z.array(PageNumber).max(MAX_SEQUENCE_LENGTH),
  copies: z.number().int().min(1).max(MAX_COPIES),
  sides: z.enum(SIDES),
  paperSize: z.enum(PAPER_SIZES),
});
export type FileSelectionBody = z.infer<typeof FileSelectionBody>;

export const SubmitJobBody = z.object({
  customerName: z.string().trim().min(1, "Please enter your name").max(40),
  note: z.string().trim().max(300).optional(),
  files: z.array(FileSelectionBody).min(1).max(MAX_FILES_PER_JOB),
  /** The price the customer saw; the server rejects the submit if its own price differs. */
  clientTotalPaise: z.number().int().min(0),
});
export type SubmitJobBody = z.infer<typeof SubmitJobBody>;

// ---- Response shapes ----

export interface ShopPublic {
  slug: string;
  name: string;
  isAccepting: boolean;
  duplexAvailable: boolean;
  rates: RateRow[];
}

export interface CreateJobResponse {
  jobId: string;
  /** Secret for this job; send as the X-Job-Token header on every later call. */
  accessToken: string;
}

export interface RegisterFileResponse {
  fileId: string;
  /** Signed URL for a direct PUT of the file bytes to storage. */
  uploadUrl: string;
  /** Content-Type to send with the PUT (must match the bucket's allowed types). */
  contentType: string;
}

export interface SubmitJobResponse {
  token: string;
  totalPaise: number;
}

export interface FileView {
  id: string;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  status: FileStatus;
  pageCount: number | null;
  error: string | null;
  /** Short-lived signed URL of the normalized PDF, present once status = ready. */
  previewUrl: string | null;
  /** The customer's choices, present after submit. */
  selection: {
    pageSequence: number[];
    colorPages: number[];
    copies: number;
    sides: Sides;
    paperSize: PaperSize;
    pricePaise: number;
  } | null;
}

export interface JobView {
  id: string;
  status: JobStatus;
  token: string | null;
  totalPaise: number | null;
  customerName: string | null;
  paidAtCounter: boolean;
  shop: { slug: string; name: string };
  files: FileView[];
}

export interface ApiError {
  error: string;
  code?: string;
}

export const JOB_TOKEN_HEADER = "x-job-token";
