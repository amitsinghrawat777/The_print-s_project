import { getShopPublic } from "@/lib/server/shops";
import { HttpError, handler, json } from "@/lib/server/http";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const shop = await getShopPublic(slug);
  if (!shop) throw new HttpError(404, "Shop not found", "SHOP_NOT_FOUND");
  return json(shop);
});
