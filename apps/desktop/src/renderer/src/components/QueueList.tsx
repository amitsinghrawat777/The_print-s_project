import { useEffect, useState } from 'react';
import { formatPaise, jobSummary, STATUS_LABEL, STATUS_STYLE, timeOf } from '../lib/format';
import type { Job } from '../lib/types';

/** Orders waiting longer than this get an amber "waiting" time. */
const SLOW_MINUTES = 10;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function minutesSince(iso: string | null, now: number) {
  return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000)) : 0;
}

function duration(minutes: number) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The one time that matters for each kind of order. */
function TimeLine({ job, now }: { job: Job; now: number }) {
  if (job.status === 'done') return <span className="text-slate-500">Collected {timeOf(job.done_at)}</span>;
  if (job.status === 'ready') return <span className="text-slate-500">Ready since {timeOf(job.printed_at)}</span>;
  const waited = minutesSince(job.submitted_at, now);
  const slow = waited >= SLOW_MINUTES && job.status !== 'building';
  return (
    <span className={slow ? 'font-medium text-amber-700' : 'text-slate-500'}>
      {timeOf(job.submitted_at)} · {waited < 1 ? 'just now' : `waiting ${duration(waited)}`}
    </span>
  );
}

export function QueueList({ jobs, selectedId, onSelect }: { jobs: Job[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const now = useNow(30_000);
  const toPrint = jobs.filter((j) => ['building', 'new', 'opened', 'printing', 'failed'].includes(j.status));
  const ready = jobs.filter((j) => j.status === 'ready');
  const done = jobs.filter((j) => j.status === 'done').reverse();
  const [showDone, setShowDone] = useState(false);

  const heading = (title: string, short: string, count: number) => (
    <h3 className="sticky top-0 z-10 bg-slate-50/95 px-2 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase backdrop-blur lg:px-4">
      <span className="hidden lg:inline">{title} · </span>
      <span className="lg:hidden" title={title}>{short} </span>
      {count}
    </h3>
  );

  const list = (items: Job[]) => (
    <ul className="space-y-1 px-2 pb-3">
      {items.map((job) => {
        const selected = job.id === selectedId;
        const fresh = job.status === 'new';
        return (
          <li key={job.id}>
            <button
              type="button"
              disabled={job.status === 'building'}
              onClick={() => onSelect(job.id)}
              aria-current={selected}
              title={`#${job.token ?? '–'} ${jobSummary(job)}`}
              className={`relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-1 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent lg:px-3 ${
                selected ? 'bg-white shadow-sm ring-2 ring-accent' : 'hover:bg-white hover:shadow-sm'
              } disabled:cursor-default disabled:opacity-60`}
            >
              {/* new orders get a blue edge; the ring is reserved for the selected order */}
              {fresh && <span className="absolute inset-y-2 left-0 w-1.5 rounded-r-full bg-accent" aria-hidden />}
              <span className="w-full shrink-0 text-center text-2xl font-bold tabular-nums lg:w-14">
                #{job.token ?? '–'}
                {fresh && <span className="mt-1 block text-[11px] font-semibold tracking-wide text-accent uppercase lg:hidden">New</span>}
              </span>
              <span className="hidden min-w-0 flex-1 lg:block">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{job.customer_name || 'Customer'}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}>{STATUS_LABEL[job.status]}</span>
                </span>
                <span className="block truncate text-sm text-slate-600">
                  {job.job_files.length} file{job.job_files.length === 1 ? '' : 's'}
                  {job.total_paise != null && ` · ${formatPaise(job.total_paise)}`}
                  {job.paid_at_counter && ' · Paid'}
                </span>
                <span className="block text-xs">
                  <TimeLine job={job} now={now} />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label="Orders" className="h-full overflow-y-auto">
      <div>
        {heading('To print', 'Print', toPrint.length)}
        {toPrint.length === 0 && (
          <p className="hidden px-4 pb-4 text-sm text-slate-500 lg:block">No orders waiting. New ones appear here with a sound.</p>
        )}
        {list(toPrint)}
      </div>
      <div>
        {heading('Ready for pickup', 'Ready', ready.length)}
        {list(ready)}
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          aria-expanded={showDone}
          className="w-full px-2 py-2 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase hover:text-slate-900 lg:px-4"
        >
          {showDone ? '▾' : '▸'} <span className="hidden lg:inline">Collected today · </span>
          <span className="lg:hidden">Done </span>
          {done.length}
        </button>
        {showDone && list(done)}
      </div>
    </nav>
  );
}
