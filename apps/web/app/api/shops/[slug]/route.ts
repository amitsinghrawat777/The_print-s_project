import { ApiError, route } from '@/lib/server/api';
import { loadShopBySlug, toPublicShop } from '@/lib/server/views';

export const GET = route(async (_req, ctx: RouteContext<'/api/shops/[slug]'>) => {
  const { slug } = await ctx.params;
  const shop = await loadShopBySlug(slug);
  if (!shop) throw new ApiError(404, 'NOT_FOUND', 'Shop not found');
  return Response.json({ shop: toPublicShop(shop) });
});
