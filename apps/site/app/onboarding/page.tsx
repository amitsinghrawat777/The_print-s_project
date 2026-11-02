import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { currentUser, ownShop } from "@/lib/supabase/server";
import { Wizard } from "./Wizard";

export const metadata: Metadata = { title: "Set up your shop" };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<Spinner className="mx-auto my-32 size-6 text-neutral-400" />}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  const { sb, user } = await currentUser();
  if (!user) redirect("/login?next=/onboarding");
  // one shop per owner: the desktop app opens the first one
  if (await ownShop(sb)) redirect("/dashboard");
  return <Wizard email={user.email ?? "your Google account"} />;
}
