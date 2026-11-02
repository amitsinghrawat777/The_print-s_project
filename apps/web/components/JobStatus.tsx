'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatPaise, type JobStatus as Status } from '@prints/shared';
import { api, ApiRequestError } from '@/lib/client/api';
import { readJobToken } from '@/lib/client/jobTokens';
import type { JobView } from '@/lib/types';
import { Spinner } from './ui';

const STEPS = ['Sent', 'Printing', 'Ready', 'Collected'] as const;
const STEP_OF: Partial<Record<Status, number>> = {
  building: 0,
  new: 0,
  opened: 0,
  printing: 1,
  ready: 2,
  done: 3,
};
const FINISHED: Status[] = ['done', 'expired'];

/** The customer's live order page: token, amount to pay, and progress. */
export function JobStatus({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [notFound, setNotFound] = useState(false);
  // undefined while server rendering, null when this phone didn't place the order
  const token = useSyncExternalStore(
    noSubscription,
    () => readJobToken(jobId),
    () => undefined,
  );

  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await api.job(jobId, token);
        if (stopped) return;
        setJob(next);
        if (FINISHED.includes(next.status)) return;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) {
          setNotFound(true);
          return;
        }
      }
      timer = setTimeout(poll, document.hidden ? 10_000 : 3000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, token]);

  const problem = token === null ? 'no-token' : notFound ? 'not-found' : null;
  if (problem) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="font-semibold">{problem === 'no-token' ? 'Open this page on the phone you ordered from' : 'Order not found'}</p>
        <p className="mt-1 text-sm text-slate-500">
          {problem === 'no-token'
            ? 'For privacy, an order can only be viewed on the phone that sent it.'
            : 'It may have expired. Orders are deleted 24 hours after they are sent.'}
        </p>
      </div>
    );
  }
  if (!job) return <StatusSkeleton />;

  const step = STEP_OF[job.status];
  const failed = job.status === 'failed' || job.status === 'expired';

  return (
    <div className="space-y-4">
      <p className="text-center text-sm font-medium text-slate-500">{job.shop.name}</p>

      <section className="rounded-3xl bg-blue-600 p-6 text-center text-white shadow-lg shadow-blue-600/20">
        <p className="text-sm font-medium text-blue-100">Your token</p>
        <p className="mt-1 text-7xl font-black tracking-tight tabular-nums" aria-live="polite">
          {job.token ? `#${job.token}` : '…'}
        </p>
        <p className="mt-2 text-sm text-blue-100">Show this at the counter</p>
        {job.totalPaise !== null && (
          <p className="mt-5 rounded-2xl bg-white/15 px-4 py-3 text-lg font-semibold">
            {job.status === 'done' ? 'Paid' : 'Pay'} {formatPaise(job.totalPaise)} at the counter
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className={`flex items-center gap-2 font-semibold ${failed ? 'text-red-700' : 'text-slate-900'}`} aria-live="polite">
          {!failed && !FINISHED.includes(job.status) && job.status !== 'ready' && <Spinner className="size-4 text-blue-600" />}
          {job.statusLabel}
        </p>
        {step !== undefined && (
          <ol className="mt-4 grid grid-cols-4 gap-1.5">
            {STEPS.map((label, i) => (
              <li key={label} className="space-y-1.5">
                <div className={`h-1.5 rounded-full ${i <= step ? 'bg-blue-600' : 'bg-slate-200'}`} />
                <p className={`text-xs ${i <= step ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{label}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Files</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {job.files.map((f) => (
            <li key={f.id} className="flex justify-between gap-3 px-4 py-2.5">
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-slate-500">
                {f.pageSequence?.length ?? f.pageCount} pg{f.copies > 1 ? ` × ${f.copies}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Link
        href={`/s/${job.shop.slug}`}
        className="block rounded-xl py-3 text-center text-sm font-semibold text-blue-700 hover:bg-blue-50"
      >
        Print something else
      </Link>
    </div>
  );
}

const noSubscription = () => () => {};

export function StatusSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-56 animate-pulse rounded-3xl bg-blue-100" />
      <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}
