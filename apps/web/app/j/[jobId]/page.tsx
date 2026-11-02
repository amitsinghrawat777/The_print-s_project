import type { Metadata } from "next";
import { Suspense } from "react";
import { JobStatus, StatusSkeleton } from "@/components/JobStatus";

export const metadata: Metadata = { title: "Your order" };

export default function JobPage({ params }: PageProps<"/j/[jobId]">) {
  return (
    <Suspense fallback={<StatusSkeleton />}>
      {params.then(({ jobId }) => (
        <JobStatus jobId={jobId} />
      ))}
    </Suspense>
  );
}
