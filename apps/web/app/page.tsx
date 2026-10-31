import { APP_NAME, TAGLINE } from "@/lib/brand";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <p className="text-sm font-medium text-brand-600">{APP_NAME}</p>
        <h1 className="mt-2 text-2xl font-semibold">Print without the queue</h1>
        <p className="mt-2 text-gray-600">{TAGLINE}</p>
        <ol className="mt-6 space-y-3 text-gray-700">
          <li>
            <span className="font-semibold">1.</span> Scan the QR code on the shop counter.
          </li>
          <li>
            <span className="font-semibold">2.</span> Upload your files and choose pages, colour and
            copies.
          </li>
          <li>
            <span className="font-semibold">3.</span> See the price, send it — collect your prints.
          </li>
        </ol>
      </div>
    </main>
  );
}
