import { fileTypeFromName, MAX_FILES_PER_JOB, registerFileBody } from '@prints/shared';
import { ApiError, parseBody, requireDraft, requireJob, route } from '@/lib/server/api';
import { bucket, db } from '@/lib/server/db';
import { toFileView, type FileRow } from '@/lib/server/views';
import type { RegisterFileResponse } from '@/lib/types';

/** Registers a file and returns a one-time signed URL to upload it to. */
export const POST = route(async (req, ctx: RouteContext<'/api/jobs/[jobId]/files'>) => {
  const { jobId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);
  const { name, size } = await parseBody(req, registerFileBody);

  const type = fileTypeFromName(name);
  if (!type) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      `"${name}" can't be printed here. Upload a PDF, Word, PowerPoint, Excel, JPG or PNG file.`,
    );
  }

  const { data: existing, error: countError } = await db()
    .from('job_files')
    .select('status, position')
    .eq('job_id', job.id);
  if (countError) throw countError;
  const active = existing.filter((f) => f.status !== 'rejected').length;
  if (active >= MAX_FILES_PER_JOB || existing.length >= MAX_FILES_PER_JOB * 2) {
    throw new ApiError(409, 'TOO_MANY_FILES', `You can add up to ${MAX_FILES_PER_JOB} files to one order`);
  }

  const fileId = crypto.randomUUID();
  const path = `${job.shop_id}/${job.id}/original/${fileId}.${type.ext}`;
  const { data: file, error } = await db()
    .from('job_files')
    .insert({
      id: fileId,
      job_id: job.id,
      shop_id: job.shop_id,
      position: Math.max(-1, ...existing.map((f) => f.position as number)) + 1,
      original_name: name,
      ext: type.ext,
      mime: type.mime,
      size_bytes: size,
      original_path: path,
    })
    .select('*')
    .single();
  if (error) throw error;

  const { data: upload, error: uploadError } = await bucket().createSignedUploadUrl(path);
  if (uploadError) throw uploadError;

  const body: RegisterFileResponse = {
    file: await toFileView(file as FileRow, false),
    upload: { url: upload.signedUrl, contentType: type.mime },
  };
  return Response.json(body, { status: 201 });
});
