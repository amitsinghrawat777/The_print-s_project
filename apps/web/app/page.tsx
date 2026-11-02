import Image from "next/image";
import Link from "next/link";
import logo from "../public/brand/logo.png";

export default function Home() {
  return (
    <div className="space-y-6 py-10 text-center">
      <Image src={logo} alt="The Print's Project" priority className="mx-auto h-auto w-44" />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Print without the queue</h1>
        <p className="text-slate-600">
          Scan the QR code on your print shop&apos;s counter to send your files straight to their printer. No WhatsApp,
          no email, no pen drive.
        </p>
      </div>
      <ol className="mx-auto max-w-xs space-y-3 text-left text-sm text-slate-700">
        <li>1. Scan the shop&apos;s QR code</li>
        <li>2. Upload your files and choose pages, colour and copies</li>
        <li>3. See the price, send, and collect with your token</li>
      </ol>
      {process.env.NODE_ENV === "development" && (
        <Link href="/s/demo-xerox" className="inline-block rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white">
          Open the demo shop
        </Link>
      )}
    </div>
  );
}
