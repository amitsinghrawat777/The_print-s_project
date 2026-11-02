import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DownloadButtons } from "@/components/DownloadButtons";
import { QrPoster } from "@/components/QrPoster";
import { Button, Card, Spinner } from "@/components/ui";
import { customerLink } from "@/lib/env";
import { detectOs } from "@/lib/os";
import { currentUser, ownShop } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<Spinner className="mx-auto my-32 size-6 text-neutral-400" />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { sb, user } = await currentUser();
  if (!user) redirect("/login?next=/dashboard");
  const shop = await ownShop(sb);
  if (!shop) redirect("/onboarding");
  const os = detectOs((await headers()).get("user-agent") ?? "");
  const email = user.email ?? "your Google account";

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-neutral-500">{email}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight" data-testid="shop-name">{shop.name}</h1>
          {shop.address && <p className="mt-1 text-neutral-600">{shop.address}</p>}
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="light" size="sm">Sign out</Button>
        </form>
      </div>

      {shop.rate_count === 0 && (
        <p className="mt-8 rounded-2xl bg-amber-50 px-5 py-4 text-amber-900 ring-1 ring-amber-200">
          <b>Your prices aren&apos;t set yet.</b> Customers can&apos;t order until they are: open the shop app and fill in the{" "}
          <b>Rate card</b>.
        </p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card title="Your shop">
            <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
              <dt className="text-neutral-500">Orders</dt>
              <dd>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    shop.is_accepting ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {shop.is_accepting ? "● Taking orders" : "Paused"}
                </span>
              </dd>
              <dt className="text-neutral-500">Customer link</dt>
              <dd className="font-mono break-all">{customerLink(shop.slug)}</dd>
              <dt className="text-neutral-500">Paper</dt>
              <dd>{shop.paper_sizes.join(", ")}</dd>
              <dt className="text-neutral-500">Prices</dt>
              <dd>{shop.rate_count} set</dd>
            </dl>
            <p className="mt-6 text-sm text-neutral-500">
              Change prices and paper sizes, or pause orders, in the shop app.
            </p>
          </Card>
          <Card title="QR code for the counter">
            <QrPoster name={shop.name} slug={shop.slug} />
          </Card>
        </div>

        <section className="h-fit rounded-3xl bg-ink p-6 text-white sm:p-8">
          <h2 className="text-lg font-semibold">The shop app</h2>
          <p className="mt-2 mb-6 text-white/70">
            Install it on the computer next to your printer. Sign in with <b className="text-white">Continue with Google</b> as{" "}
            <b className="text-white">{email}</b> and your shop opens by itself.
          </p>
          <DownloadButtons os={os} dark />
        </section>
      </div>
    </div>
  );
}
