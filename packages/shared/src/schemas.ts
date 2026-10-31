import { z } from 'zod';
import {
  MAX_COPIES,
  MAX_CUSTOMER_NAME,
  MAX_FILE_BYTES,
  MAX_FILES_PER_JOB,
  MAX_NOTE,
  MAX_SEQUENCE_LENGTH,
} from './constants';
import { PAPER_SIZES, SIDES } from './pricing';

/** Request bodies for the public API. The web app and API both use these. */

export const createJobBody = z.object({
  slug: z.string().min(1).max(40),
});
export type CreateJobBody = z.infer<typeof createJobBody>;

export const registerFileBody = z.object({
  name: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
});
export type RegisterFileBody = z.infer<typeof registerFileBody>;

const pageNumber = z.number().int().positive();

export const fileOptionsBody = z.object({
  fileId: z.uuid(),
  pageSequence: z.array(pageNumber).min(1).max(MAX_SEQUENCE_LENGTH),
  colorPages: z.array(pageNumber).max(MAX_SEQUENCE_LENGTH),
  copies: z.number().int().min(1).max(MAX_COPIES),
  sides: z.enum(SIDES),
  paperSize: z.enum(PAPER_SIZES),
});
export type FileOptionsBody = z.infer<typeof fileOptionsBody>;

export const submitJobBody = z.object({
  customerName: z.string().trim().min(1, 'Enter your name').max(MAX_CUSTOMER_NAME),
  note: z.string().trim().max(MAX_NOTE).default(''),
  /** In print order. */
  files: z
    .array(fileOptionsBody)
    .min(1)
    .max(MAX_FILES_PER_JOB)
    .refine((files) => new Set(files.map((f) => f.fileId)).size === files.length, 'Duplicate file'),
  /** The price the customer saw. The server's own price must match it. */
  clientTotalPaise: z.number().int().nonnegative(),
});
export type SubmitJobBody = z.infer<typeof submitJobBody>;

export const processFileBody = z.object({ fileId: z.uuid() });
export const buildJobBody = z.object({ jobId: z.uuid() });

/** Error codes the API returns as `{ error: { code, message } }`. */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'SHOP_PAUSED'
  | 'RATE_LIMITED'
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED_FILE'
  | 'NOT_EDITABLE'
  | 'FILES_NOT_READY'
  | 'PRICE_CHANGED'
  | 'INTERNAL';

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}
