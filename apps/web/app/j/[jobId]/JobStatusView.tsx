"use client";

import { useEffect, useState } from "react";
import {
  JOB_STATUS_LABEL,
  formatPageRange,
  formatPaise,
  type JobStatus,
  type JobView,
} from "@print/shared";
import { ApiRequestError, api, jobStore } from "@/lib/client/api";
import { describeSelection } from "@/lib/client/order";
import { Spinner, cx } from "@/components/ui";

const POLL_MS = 3000;
const FINAL: JobStatus[] = ["done", "expired", "failed"];
const STEPS: { status: JobStatus[]; label: string }[] = [
  { status: ["building", "new", "opened"], label: "Sent" },
  { status: ["printing"], label: "Printing" },
  { status: ["ready", "done"], label: "Ready" },
];

export function JobStatusView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = jobStore.tokenFor(jobId);
    if (!token) {
      setError("Open this page on the phone you ordered from.");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const view = await api.getJob(jobId, token);
        if (stopped) return;
        setJob(view);
        if (!FINAL.includes(view.status)) timer = setTimeout(load, POLL_MS);
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiRequestError && err.status === 404) {
          setError("We couldn't find this order. It may have expired.");
        } else {
          timer = setTimeout(load, POLL_MS * 2);
        }
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
        <p className="text-gray-700">{error}</p>
      </div>
    );
  }
  if (!job) {
    return (
      <p className="flex items-center gap-2 text-gray-500">
        <Spinner /> Loading your order…
      </p>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.status.includes(job.status));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
        <p className="text-sm text-gray-500">{job.shop.name}</p>
        <p className="mt-3 text-sm font-medium text-gray-600">Your token</p>
        <p className="text-6xl font-black tracking-tight text-brand-700" aria-live="polite">
          {job.token ? `#${job.token}` : "…"}
        </p>
        <p className="mt-3 text-lg font-semibold">{JOB_STATUS_LABEL[job.status]}</p>

        {stepIndex >= 0 && (
          <ol className="mt-5 flex items-center justify-between gap-2" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s.label} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={cx(
                    "h-1.5 w-full rounded-full",
                    i <= stepIndex ? "bg-brand-500" : "bg-gray-200",
                  )}
                />
                <span className={cx("text-xs", i <= stepIndex ? "text-gray-900" : "text-gray-400")}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {job.totalPaise !== null && (
        <section className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <div>
            <p className="text-sm text-gray-500">{job.paidAtCounter ? "Paid" : "Pay at the counter"}</p>
            <p className="text-2xl font-bold">{formatPaise(job.totalPaise)}</p>
          </div>
          {job.paidAtCounter ? (
            <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">Paid ✓</span>
          ) : (
            <span className="text-right text-xs text-gray-500">Show this screen
              <br />
              when you collect
            </span>
          )}
        </section>
      )}

      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
          {job.customerName ? `${job.customerName}'s files` : "Files"}
        </h2>
        <ul className="divide-y divide-gray-100">
          {job.files
            .filter((f) => f.selection)
            .map((f) => (
              <li key={f.id} className="px-4 py-3">
                <div className="flex justify-between gap-3">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="shrink-0 font-medium">{formatPaise(f.selection!.pricePaise)}</p>
                </div>
                <p className="text-sm text-gray-500">
                  {describeSelection(f.selection!, f.pageCount, formatPageRange)}
                </p>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
