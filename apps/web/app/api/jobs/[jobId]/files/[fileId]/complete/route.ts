import { db } from "@/lib/server/db";
import { HttpError, handler, json } from "@/lib/server/http";
import { requireDraft, requireJob } from "@/lib/server/jobs";
import { notifyProcessor } from "@/lib/server/processor";

type Ctx = { params: Promise<{ jobId: string; fileId: string }> };

/** The browser finished uploading: queue the file for checking + conversion. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { jobId, fileId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);

  const { data: file, error } = await db()
    .from("job_files")
    .select("id, status")
    .eq("id", fileId)
    .eq("job_id", jobId)
    .maybeSingle<{ id: string; status: string }>();
  if (error) throw new HttpError(500, "Could not update file");
  if (!file) throw new HttpError(404, "File not found", "NOT_FOUND");

  if (file.status === "pending_upload") {
    const { error: upErr } = await db()
      .from("job_files")
      .update({ status: "uploaded" })
      .eq("id", fileId)
      .eq("status", "pending_upload");
    if (upErr) throw new HttpError(500, "Could not update file");
  }
  if (file.status === "pending_upload" || file.status === "uploaded") {
    await notifyProcessor("/process-file", { fileId });
  }
  return json({ ok: true }, 202);
});
