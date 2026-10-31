import "server-only";
import { SLUG_PATTERN, type RateRow, type ShopPublic } from "@print/shared";
import { db } from "./db";
import { HttpError } from "./http";

export interface ShopRow {
  id: string;
  slug: string;
  name: string;
  is_accepting: boolean;
  duplex_available: boolean;
}

interface RateDbRow {
  paper_size: RateRow["paperSize"];
  color_mode: RateRow["colorMode"];
  sides: RateRow["sides"];
  price_paise: number;
}

export async function loadShopBySlug(slug: string): Promise<ShopRow | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const { data, error } = await db()
    .from("shops")
    .select("id, slug, name, is_accepting, duplex_available")
    .eq("slug", slug)
    .maybeSingle<ShopRow>();
  if (error) throw new HttpError(500, "Could not load shop");
  return data;
}

export async function loadRates(shopId: string, duplexAvailable: boolean): Promise<RateRow[]> {
  const { data, error } = await db()
    .from("shop_rates")
    .select("paper_size, color_mode, sides, price_paise")
    .eq("shop_id", shopId)
    .order("paper_size")
    .returns<RateDbRow[]>();
  if (error) throw new HttpError(500, "Could not load prices");
  return (data ?? [])
    .filter((r) => duplexAvailable || r.sides === "single")
    .map((r) => ({
      paperSize: r.paper_size,
      colorMode: r.color_mode,
      sides: r.sides,
      pricePaise: r.price_paise,
    }));
}

export async function getShopPublic(slug: string): Promise<ShopPublic | null> {
  const shop = await loadShopBySlug(slug);
  if (!shop) return null;
  return {
    slug: shop.slug,
    name: shop.name,
    isAccepting: shop.is_accepting,
    duplexAvailable: shop.duplex_available,
    rates: await loadRates(shop.id, shop.duplex_available),
  };
}
