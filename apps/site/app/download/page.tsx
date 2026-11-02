import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { DownloadButtons } from "@/components/DownloadButtons";
import { WindowFrame } from "@/components/Frames";
import { ButtonLink, StepNumber } from "@/components/ui";
import { detectOs } from "@/lib/os";
import rates from "../../public/shots/desktop-rates.png";

export const metadata: Metadata = { title: "Download the shop app" };

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid items-center gap-14 lg:grid-cols-[2fr_3fr]">
        <div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Download the shop app</h1>
          <p className="mt-5 text-lg text-neutral-600">
            Install it on the computer connected to your printer. Orders arrive there with a sound, ready to print.
          </p>
          <div className="mt-9">
            <Suspense fallback={<DownloadButtons os="windows" />}>
              <ForThisComputer />
            </Suspense>
          </div>
        </div>
        <WindowFrame src={rates} alt="The shop app's rate card" priority />
      </div>

      <section className="mt-24">
        <h2 className="text-2xl font-bold tracking-tight">After installing</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            ["Open the app", "It starts with your computer, so you never miss an order."],
            ["Continue with Google", "Use the same Google account you set up your shop with. Your shop opens by itself."],
            ["Choose your printers", "In Settings, pick the printer for B&W and the one for colour. That's it."],
          ].map(([title, text], i) => (
            <li key={title} className="rounded-3xl bg-white p-7 ring-1 ring-neutral-200">
              <StepNumber n={i + 1} />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-neutral-600">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-neutral-600">
          No shop yet?{" "}
          <ButtonLink href="/onboarding" variant="ghost" size="sm" className="-ml-2 text-accent">
            Set it up first →
          </ButtonLink>
        </p>
      </section>
    </div>
  );
}

async function ForThisComputer() {
  const ua = (await headers()).get("user-agent") ?? "";
  return <DownloadButtons os={detectOs(ua)} />;
}
