import { ApiError, requireDraft, requireJob, route } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import { notifyProcessor } from '@/lib/server/processor';
import { loadFile, toFileView } from '@/lib/server/views';

/** Called after the browser finishes uploading. Starts conversion and page counting. */
export const POST = route(async (req, ctx: RouteContext<'/api/jobs/[jobId]/files/[fileId]/complete'>) => {
  const { jobId, fileId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);
  let file = await loadFile(job.id, fileId);
  if (!file) throw new ApiError(404, 'NOT_FOUND', 'File not found');

  if (file.status === 'pending_upload') {
    const { error } = await db()
      .from('job_files')
      .update({ status: 'uploaded' })
      .eq('id', file.id)
      .eq('status', 'pending_upload');
    if (error) throw error;
    await notifyProcessor('/process-file', { fileId: file.id });
    file = (await loadFile(job.id, fileId))!;
  }
  return Response.json({ file: await toFileView(file, true) });
});
