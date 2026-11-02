import { useEffect, useState } from 'react';
import { ago, formatPaise, jobSummary, STATUS_LABEL, STATUS_STYLE, timeOf } from '../lib/format';
import type { Job } from '../lib/types';

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function QueueList({ jobs, selectedId, onSelect }: { jobs: Job[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const now = useNow(30_000);
  const toPrint = jobs.filter((j) => ['building', 'new', 'opened', 'printing', 'failed'].includes(j.status));
  const ready = jobs.filter((j) => j.status === 'ready');
  const done = jobs.filter((j) => j.status === 'done').reverse();
  const [showDone, setShowDone] = useState(false);

  const section = (title: string, list: Job[], empty?: string) => (
    <div>
      {title && (
      <h3 className="sticky top-0 z-10 bg-slate-50/95 px-4 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase backdrop-blur">
        {title} <span className="text-slate-400">· {list.length}</span>
      </h3>
      )}
      {list.length === 0 && empty && <p className="px-4 pb-4 text-sm text-slate-400">{empty}</p>}
      <ul className="space-y-1 px-2 pb-3">
        {list.map((job) => {
          const selectable = job.status !== 'building';
          const selected = job.id === selectedId;
          return (
            <li key={job.id}>
              <button
                type="button"
                disabled={!selectable}
                onClick={() => onSelect(job.id)}
                aria-current={selected}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                  selected ? 'bg-white shadow-sm ring-2 ring-blue-500' : 'hover:bg-white hover:shadow-sm'
                } ${job.status === 'new' && !selected ? 'bg-blue-50 ring-1 ring-blue-200' : ''} disabled:cursor-default disabled:opacity-60`}
              >
                <span className="w-14 shrink-0 text-center text-2xl font-bold tabular-nums">#{job.token ?? '–'}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{job.customer_name || 'Customer'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}>{STATUS_LABEL[job.status]}</span>
                  </span>
                  <span className="block truncate text-sm text-slate-500">
                    {job.job_files.length} file{job.job_files.length === 1 ? '' : 's'}
                    {job.total_paise != null && ` · ${formatPaise(job.total_paise)}`}
                    {job.paid_at_counter && ' · Paid'}
                  </span>
                  <span className="block text-xs text-slate-400" title={jobSummary(job)}>
                    {timeOf(job.submitted_at)} · {ago(job.submitted_at, now)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <nav aria-label="Orders" className="h-full overflow-y-auto">
      {section('To print', toPrint, 'No orders waiting. New ones appear here with a sound.')}
      {section('Ready for pickup', ready)}
      <div>
        <button type="button" onClick={() => setShowDone((v) => !v)} className="w-full px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-700">
          {showDone ? '▾' : '▸'} Collected today <span className="text-slate-400">· {done.length}</span>
        </button>
        {showDone && section('', done)}
      </div>
    </nav>
  );
}
