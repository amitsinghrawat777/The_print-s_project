export const JOB_STATUSES = [
  'draft', // customer is still adding files and choosing options
  'building', // submitted and priced; processor is building print-ready PDFs
  'new', // in the shop's queue
  'opened', // owner opened it
  'printing', // sent to the printer
  'ready', // printed; waiting for the customer to collect
  'done', // collected (and paid at the counter)
  'failed', // build failed; can be retried
  'expired', // never finished; files purged
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Allowed status changes. Keep in sync with `check_job_transition()` in
 * supabase/migrations (the database enforces the same table).
 */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  draft: ['building', 'expired'],
  building: ['new', 'failed', 'expired'],
  new: ['opened', 'printing', 'done', 'expired'],
  opened: ['new', 'printing', 'ready', 'done', 'expired'],
  printing: ['opened', 'ready', 'done', 'expired'],
  ready: ['printing', 'done', 'expired'],
  done: [],
  failed: ['building', 'expired'],
  expired: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/** Statuses the shop's queue shows. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['new', 'opened', 'printing', 'ready'];

export const FILE_STATUSES = [
  'pending_upload',
  'uploaded',
  'processing',
  'ready',
  'rejected',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** What the customer sees on their status page. */
export const CUSTOMER_STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Not sent yet',
  building: 'Preparing your order…',
  new: 'Sent to the shop',
  opened: 'The shop is looking at your order',
  printing: 'Printing…',
  ready: 'Ready! Collect it at the counter',
  done: 'Collected. Thank you!',
  failed: 'Something went wrong. Please talk to the shop.',
  expired: 'This order has expired',
};
