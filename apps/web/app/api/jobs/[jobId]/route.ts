import { buildJobView, requireJob } from "@/lib/server/jobs";
import { handler, json } from "@/lib/server/http";

/** The customer's view of their order (files, page counts, status, token, total). */
export const GET = handler(async (req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const { jobId } = await ctx.params;
  const job = await requireJob(req, jobId);
  return json(await buildJobView(job));
});
