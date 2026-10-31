import { ApiError, requireDraft, requireJob, route } from '@/lib/server/api';
import { bucket, db } from '@/lib/server/db';
import { loadFile } from '@/lib/server/views';

/** Removes a file from a draft order. */
export const DELETE = route(async (req, ctx: RouteContext<'/api/jobs/[jobId]/files/[fileId]'>) => {
  const { jobId, fileId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);
  const file = await loadFile(job.id, fileId);
  if (!file) throw new ApiError(404, 'NOT_FOUND', 'File not found');

  const paths = [...new Set([file.original_path, file.pdf_path].filter((p): p is string => !!p))];
  await bucket().remove(paths);
  const { error } = await db().from('job_files').delete().eq('id', file.id);
  if (error) throw error;
  return new Response(null, { status: 204 });
});
