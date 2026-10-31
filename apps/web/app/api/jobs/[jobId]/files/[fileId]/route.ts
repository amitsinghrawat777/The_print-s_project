import { JOBS_BUCKET, storagePaths } from "@print/shared";
import { db } from "@/lib/server/db";
import { HttpError, handler, json } from "@/lib/server/http";
import { requireDraft, requireJob } from "@/lib/server/jobs";

type Ctx = { params: Promise<{ jobId: string; fileId: string }> };

/** Remove a file from a draft order (and its stored bytes). */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const { jobId, fileId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);

  const { data: file, error } = await db()
    .from("job_files")
    .delete()
    .eq("id", fileId)
    .eq("job_id", jobId)
    .select("original_path, pdf_path")
    .maybeSingle<{ original_path: string; pdf_path: string | null }>();
  if (error) throw new HttpError(500, "Could not remove file");
  if (!file) throw new HttpError(404, "File not found", "NOT_FOUND");

  const paths = [file.original_path, storagePaths.pdf(job.shop_id, jobId, fileId)];
  const { error: rmErr } = await db().storage.from(JOBS_BUCKET).remove(paths);
  if (rmErr) console.warn("[files] storage remove failed; cleanup will retry", rmErr.message);

  return json({ ok: true });
});
