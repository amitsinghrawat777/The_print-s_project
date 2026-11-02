import { canTransition, type JobStatus } from '@prints/shared';
import { supabase } from './supabase';
import type { Job } from './types';

/**
 * Moves a job along the status machine. The database enforces the same rules
 * (and logs every change in job_events); this check just avoids pointless calls.
 * Returns an error message, or null on success.
 */
export async function setJobStatus(job: Job, to: JobStatus, extra: { paid_at_counter?: boolean } = {}): Promise<string | null> {
  if (job.status !== to && !canTransition(job.status, to)) return null;
  const patch = job.status === to ? extra : { status: to, ...extra };
  if (Object.keys(patch).length === 0) return null;
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select('id');
  if (error) return error.message;
  if (!data?.length) return 'This order could not be updated. It may have expired.';
  return null;
}

export async function setPaid(job: Job, paid: boolean): Promise<string | null> {
  const { data, error } = await supabase.from('jobs').update({ paid_at_counter: paid }).eq('id', job.id).select('id');
  if (error) return error.message;
  return data?.length ? null : 'This order could not be updated.';
}
