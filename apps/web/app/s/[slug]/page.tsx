import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getShopPublic } from "@/lib/server/shops";
import { OrderFlow } from "./OrderFlow";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await getShopPublic((await params).slug);
  return { title: shop ? `Print at ${shop.name}` : "Shop not found" };
}

export default async function ShopPage({ params }: Props) {
  const shop = await getShopPublic((await params).slug);
  if (!shop) notFound();

  return (
    <main className="mx-auto max-w-md px-4 pt-6 pb-40">
      <header className="mb-5">
        <p className="text-sm text-gray-500">Printing at</p>
        <h1 className="text-2xl font-semibold leading-tight">{shop.name}</h1>
      </header>
      {shop.isAccepting ? (
        <OrderFlow shop={shop} />
      ) : (
        <div className="rounded-2xl bg-amber-50 p-5 text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Not taking online orders right now</p>
          <p className="mt-1 text-sm">Please ask at the counter.</p>
        </div>
      )}
    </main>
  );
}
