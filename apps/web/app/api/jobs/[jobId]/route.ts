import { requireJob, route } from '@/lib/server/api';
import { loadShopById, toJobView } from '@/lib/server/views';

export const GET = route(async (req, ctx: RouteContext<'/api/jobs/[jobId]'>) => {
  const { jobId } = await ctx.params;
  const job = await requireJob(req, jobId);
  const shop = await loadShopById(job.shop_id);
  return Response.json({ job: await toJobView(job, shop) }, { headers: { 'cache-control': 'no-store' } });
});
