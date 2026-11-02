import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderFlow } from "@/components/order/OrderFlow";
import { loadShopBySlug, toPublicShop } from "@/lib/server/views";

export default function ShopPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <Suspense fallback={<ShopSkeleton />}>
      <Shop params={params} />
    </Suspense>
  );
}

async function Shop({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await loadShopBySlug(slug);
  if (!shop) notFound();

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{shop.name}</h1>
          {shop.address && <p className="truncate text-sm text-slate-500">{shop.address}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            shop.is_accepting ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"
          }`}
        >
          {shop.is_accepting ? "● Taking orders" : "Paused"}
        </span>
      </header>
      <OrderFlow shop={toPublicShop(shop)} />
    </div>
  );
}

function ShopSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="h-12 w-2/3 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}
