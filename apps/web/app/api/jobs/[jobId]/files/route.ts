import {
  JOBS_BUCKET,
  MAX_FILES_PER_JOB,
  RegisterFileBody,
  checkUpload,
  sanitizeFileName,
  storagePaths,
  type RegisterFileResponse,
} from "@print/shared";
import { db } from "@/lib/server/db";
import { HttpError, handler, json, parseBody } from "@/lib/server/http";
import { requireDraft, requireJob } from "@/lib/server/jobs";
import { rateLimitByIp } from "@/lib/server/rateLimit";

/**
 * Register a file on a draft order and get a signed URL to upload its bytes
 * straight to storage (the bytes never pass through this server).
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const { jobId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);
  if (!job.shops.is_accepting) {
    throw new HttpError(409, "This shop isn't taking orders right now.", "SHOP_PAUSED");
  }

  const body = await parseBody(req, RegisterFileBody);
  const check = checkUpload(body.name, body.size);
  if (!check.ok) throw new HttpError(422, check.error, "BAD_FILE");
  await rateLimitByIp(req, "register-file", 60, 600);

  const { count, error: countErr } = await db()
    .from("job_files")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .neq("status", "rejected");
  if (countErr) throw new HttpError(500, "Could not add file");
  if ((count ?? 0) >= MAX_FILES_PER_JOB) {
    throw new HttpError(422, `You can add up to ${MAX_FILES_PER_JOB} files per order.`, "TOO_MANY_FILES");
  }

  const fileId = crypto.randomUUID();
  const path = storagePaths.original(job.shop_id, jobId, fileId, check.type.ext);
  const { error: insErr } = await db().from("job_files").insert({
    id: fileId,
    job_id: jobId,
    shop_id: job.shop_id,
    position: count ?? 0,
    original_name: sanitizeFileName(body.name),
    kind: check.type.kind,
    ext: check.type.ext,
    mime: check.type.mime,
    size_bytes: body.size,
    original_path: path,
  });
  if (insErr) throw new HttpError(500, "Could not add file");

  const { data: signed, error: signErr } = await db()
    .storage.from(JOBS_BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw new HttpError(500, "Could not start upload");

  return json<RegisterFileResponse>(
    { fileId, uploadUrl: signed.signedUrl, contentType: check.type.mime },
    201,
  );
});
