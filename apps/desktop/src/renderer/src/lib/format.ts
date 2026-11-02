import { formatPageRange, formatPaise, isAllPagesInOrder, type JobStatus } from '@prints/shared';
import type { Job, JobFile } from './types';

export { formatPaise };

const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export function timeOf(iso: string | null) {
  return iso ? clock.format(new Date(iso)) : '';
}

export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return '';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

/** "today at 6:00 am", "tomorrow at 6:00 am" or "on Monday at 6:00 am". */
export function whenLabel(date: Date, now = new Date()) {
  const time = clock.format(date);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === now.toDateString()) return `today at ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `on ${date.toLocaleDateString('en-IN', { weekday: 'long' })} at ${time}`;
}

/** The next 6 am on this computer, which is when a pause ends (the database uses the shop's timezone). */
export function nextMorning(now = new Date()) {
  const d = new Date(now);
  d.setHours(6, 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Draft',
  building: 'Preparing…',
  new: 'New',
  opened: 'Opened',
  printing: 'Printing',
  ready: 'Ready',
  done: 'Done',
  failed: 'Failed',
  expired: 'Expired',
};

export const STATUS_STYLE: Record<JobStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  building: 'bg-slate-100 text-slate-600',
  new: 'bg-accent text-white',
  opened: 'bg-accent-soft text-accent ring-1 ring-accent-line',
  printing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  done: 'bg-slate-100 text-slate-500',
  failed: 'bg-red-100 text-red-700',
  expired: 'bg-slate-100 text-slate-500',
};

export function pagesLabel(file: JobFile) {
  const seq = file.page_sequence ?? [];
  if (file.page_count && isAllPagesInOrder(seq, file.page_count)) return `All ${seq.length} page${seq.length === 1 ? '' : 's'}`;
  return `Pages ${formatPageRange(seq)} (${seq.length})`;
}

export function colourLabel(file: JobFile) {
  const seq = file.page_sequence ?? [];
  const colour = seq.filter((p) => file.color_pages.includes(p)).length;
  if (colour === 0) return 'B&W';
  if (colour === seq.length) return 'Colour';
  return `Mixed: ${formatPageRange(file.color_pages)} in colour`;
}

/** "2 files · 14 pages" for notifications and the queue. */
export function jobSummary(job: Job) {
  const files = job.job_files.length;
  const pages = job.job_files.reduce((n, f) => n + (f.page_sequence?.length ?? 0) * f.copies, 0);
  const who = job.customer_name ? `${job.customer_name} · ` : '';
  const price = job.total_paise != null ? ` · ${formatPaise(job.total_paise)}` : '';
  return `${who}${files} file${files === 1 ? '' : 's'} · ${pages} page${pages === 1 ? '' : 's'}${price}`;
}
