import type { Metadata } from "next";
import { JobStatusView } from "./JobStatusView";

export const metadata: Metadata = { title: "Your order" };

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <JobStatusView jobId={jobId} />
    </main>
  );
}
