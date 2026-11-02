import Image from "next/image";
import { PhoneFrame, WindowFrame } from "@/components/Frames";
import wordmarkOnDark from "../public/brand/wordmark-on-dark.png";
import { ButtonLink, Eyebrow, StepNumber } from "@/components/ui";
import { downloadsAvailable } from "@/lib/env";
import shopPhone from "../public/shots/phone-files.png";
import customisedPhone from "../public/shots/phone-customise.png";
import statusPhone from "../public/shots/phone-status.png";
import orderDesktop from "../public/shots/desktop-order.png";
import queueDesktop from "../public/shots/desktop-queue.png";

const STEPS = [
  {
    title: "They scan your QR code",
    text: "A poster on your counter opens your shop's page on any phone. Nothing to install, no account.",
    shot: shopPhone,
    alt: "A shop's page on a phone with a 4-page lab report added, showing a thumbnail of each page",
  },
  {
    title: "They choose, and see the price",
    text: "Pages, B&W or colour, copies, one or both sides. The price comes from your rate card as they choose.",
    shot: customisedPhone,
    alt: "Choosing colour page by page on a phone: page 3 in colour, the rest B&W, with the total at the bottom",
  },
  {
    title: "They get a token, you print",
    text: "The order appears in your app with a sound. Press Print: the settings are already filled in.",
    shot: statusPhone,
    alt: "The customer's token #7 with 'Pay ₹42 at the counter' and the order status on a phone",
  },
];

const FEATURES = [
  { title: "No WhatsApp, no pen drive", text: "Files come straight to the shop app. Nothing lands in your Downloads folder or your phone's gallery." },
  { title: "The right price, every time", text: "Your rate card does the maths: per page, per sheet, colour and paper size. The customer sees it before sending." },
  { title: "Printer settings filled in", text: "Pages, copies, sides and paper come with the order. Colour pages can go to your colour printer and the rest to B&W." },
  { title: "Token numbers at the counter", text: "Orders get #1, #2, #3 each day. The customer's phone shows when their order is ready to collect." },
  { title: "Preview before you print", text: "Check every page inside the app before a single sheet comes out." },
  { title: "Pause when you're busy", text: "Stop new orders with one switch. They start again by themselves the next morning." },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
        <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm text-neutral-600 ring-1 ring-neutral-200">
          <span className="size-1.5 rounded-full bg-green-500" /> For print and xerox shops
        </p>
        <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">
          Customers send the files.
          <br className="hidden sm:block" /> You press Print.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-neutral-600">
          Customers scan the QR code at your counter, upload their files and choose pages, colour and copies.
          The order lands in your desktop app with the price worked out and the printer settings filled in.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/onboarding" variant="dark" size="lg">Set up your shop</ButtonLink>
          {downloadsAvailable ? (
            <ButtonLink href="/download" variant="light" size="lg">Download the app</ButtonLink>
          ) : (
            <ButtonLink href="/#how" variant="light" size="lg">See how it works</ButtonLink>
          )}
        </div>
        <p className="mt-4 text-sm text-neutral-500">Takes about five minutes · Works with the printers you already have</p>
      </section>

      {/* Product stage */}
      <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink px-4 pt-10 pb-0 sm:px-12 sm:pt-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(60%_50%_at_50%_0%,rgba(37,99,235,0.35),transparent)]"
          />
          {/* the desktop window is unreadable at phone width, so phones see the customer's screens */}
          <div className="relative mx-auto hidden max-w-4xl md:block">
            <WindowFrame src={orderDesktop} alt="The shop app showing an order with its token, price, files and print buttons" priority />
          </div>
          <div className="relative flex justify-center gap-4 md:hidden">
            <PhoneFrame src={customisedPhone} alt="The customer choosing pages and colour on a phone" className="-mb-16 w-40" />
            <PhoneFrame src={statusPhone} alt="The customer's token number and order status on a phone" className="-mb-16 mt-10 w-40" />
          </div>
          <PhoneFrame
            src={customisedPhone}
            alt="The customer choosing pages and colour on a phone"
            className="absolute right-4 bottom-0 hidden w-44 translate-y-10 md:block lg:right-16 lg:w-56"
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">From the customer&apos;s phone to your printer</h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-neutral-200">
              <div className="p-6 sm:p-7">
                <StepNumber n={i + 1} />
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-neutral-600">{step.text}</p>
              </div>
              <div className="mt-auto flex justify-center bg-neutral-100 px-6 pt-6">
                <PhoneFrame src={step.shot} alt={step.alt} className="w-48 -mb-24" />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* The shop app */}
      <section className="bg-white py-24 ring-1 ring-neutral-200">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[2fr_3fr]">
          <div>
            <Eyebrow>The shop app</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">One queue for every order</h2>
            <p className="mt-4 text-lg text-neutral-600">
              New orders ring in, with the token, the files and what the customer will pay at the counter. Print, mark it
              ready, take the money, done.
            </p>
            {downloadsAvailable ? (
              <ButtonLink href="/download" variant="dark" className="mt-8">Download for your computer</ButtonLink>
            ) : (
              <ButtonLink href="/onboarding" variant="dark" className="mt-8">Set up your shop</ButtonLink>
            )}
          </div>
          <WindowFrame src={queueDesktop} alt="The shop app's order queue, with orders to print, ready for pickup and collected" />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
        <Eyebrow>Features</Eyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Built for a busy counter</h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl bg-neutral-200 ring-1 ring-neutral-200 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-paper p-7">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-neutral-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Setup */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="rounded-[2rem] bg-ink px-6 py-14 text-white sm:px-14">
          <Image src={wordmarkOnDark} alt="" sizes="200px" className="mb-10 h-14 w-auto sm:h-16" />
          <h2 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Your shop can be taking orders today</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            {[
              ["Sign in with Google", "Use the Google account you'll use in the shop app."],
              ["Add your shop and prices", "Your name, your link, and what you charge per page."],
              ["Print your QR and install", "Put the poster on the counter and open the app on your shop computer."],
            ].map(([title, text], i) => (
              <li key={title}>
                <StepNumber n={i + 1} dark />
                <p className="mt-4 text-lg font-semibold">{title}</p>
                <p className="mt-1 text-white/70">{text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/onboarding" variant="light" size="lg">Set up your shop</ButtonLink>
            {downloadsAvailable && <ButtonLink href="/download" variant="glass" size="lg">Download the app</ButtonLink>}
          </div>
        </div>
      </section>
    </>
  );
}
