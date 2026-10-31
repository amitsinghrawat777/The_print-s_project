/**
 * Job and file status machines. The same transitions are enforced in Postgres by the
 * `check_job_transition` trigger (supabase/migrations); keep both in sync.
 */

export const JOB_STATUSES = [
  "draft",
  "building",
  "new",
  "opened",
  "printing",
  "ready",
  "done",
  "failed",
  "expired",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  draft: ["building", "expired"],
  building: ["new", "failed", "expired"],
  new: ["opened", "printing", "ready", "done", "expired"],
  opened: ["printing", "ready", "done", "expired"],
  printing: ["ready", "opened", "done", "expired"],
  ready: ["done", "printing", "expired"],
  done: ["expired"],
  failed: ["building", "expired"],
  expired: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export const FILE_STATUSES = [
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "rejected",
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** Statuses an owner sees in the live queue. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["new", "opened", "printing", "ready"];

/** Customer-facing label for each job status. */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Not sent yet",
  building: "Preparing your files…",
  new: "Sent to shop ✓",
  opened: "Shop is looking at it",
  printing: "Printing…",
  ready: "Ready — collect from the counter ✓",
  done: "Done ✓",
  failed: "Something went wrong — please ask the shop",
  expired: "Expired",
};
