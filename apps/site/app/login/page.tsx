import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { siteEnv } from "@/lib/env";
import { safeNext } from "@/lib/os";
import { currentUser } from "@/lib/supabase/server";
import wordmark from "../../public/brand/wordmark-on-light.png";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="flex justify-center px-4 py-16 sm:py-24">
      <div className="w-full max-w-sm text-center">
        <Image src={wordmark} alt="" sizes="200px" className="mx-auto h-16 w-auto" priority />
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in to set up your shop</h1>
        <p className="mt-2 text-neutral-600">Use the Google account you&apos;ll sign in to the shop app with.</p>
        <Suspense fallback={<Spinner className="mx-auto mt-10 size-6 text-neutral-400" />}>
          <Form searchParams={searchParams} />
        </Suspense>
        <p className="mt-10 text-xs text-neutral-500">
          Only shop owners sign in here. Customers don&apos;t need an account: they scan the shop&apos;s QR code.
        </p>
      </div>
    </div>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(params.next));
  const { user } = await currentUser();
  if (user) redirect(next);
  return <LoginForm next={next} error={one(params.error) ?? null} allowPassword={siteEnv.allowPasswordLogin} />;
}
