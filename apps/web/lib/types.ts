import type { FileStatus, JobStatus, PaperSize, Rate, Sides } from '@prints/shared';

/** API response shapes, used by both the route handlers and the browser. */

export interface PublicShop {
  slug: string;
  name: string;
  address: string | null;
  isAccepting: boolean;
  duplexAvailable: boolean;
  paperSizes: PaperSize[];
  rates: Rate[];
}

export interface JobFileView {
  id: string;
  name: string;
  status: FileStatus;
  sizeBytes: number;
  pageCount: number | null;
  error: string | null;
  /** Short-lived link to the PDF, only while the order is a draft. */
  previewUrl: string | null;
  pageSequence: number[] | null;
  colorPages: number[];
  copies: number;
  sides: Sides;
  paperSize: PaperSize;
  pricePaise: number | null;
}

export interface JobView {
  id: string;
  status: JobStatus;
  statusLabel: string;
  token: string | null;
  customerName: string | null;
  note: string | null;
  subtotalPaise: number | null;
  roundingPaise: number | null;
  totalPaise: number | null;
  createdAt: string;
  submittedAt: string | null;
  shop: { name: string; slug: string };
  files: JobFileView[];
}

export interface CreateJobResponse {
  jobId: string;
  accessToken: string;
}

export interface RegisterFileResponse {
  file: JobFileView;
  upload: { url: string; contentType: string };
}
