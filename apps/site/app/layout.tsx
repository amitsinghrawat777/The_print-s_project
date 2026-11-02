import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import { Header } from "@/components/Header";
// solid wordmark at small sizes; the gradient ones are for large placements
import wordmark from "../public/brand/mark.png";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "The Print's Project · Print orders straight from your counter's QR code", template: "%s · The Print's Project" },
  description:
    "Customers scan your shop's QR code, upload their files, choose pages and colour and see the price. You print from one desktop app. No WhatsApp, no pen drive.",
  icons: {
    icon: [
      { url: "/brand/icon-light.png", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/brand/icon-dark.png", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/brand/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-neutral-200">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-neutral-500 sm:flex-row sm:items-center sm:px-6">
            <Image src={wordmark} alt="The Print's Project" sizes="80px" className="h-5 w-auto self-start sm:self-auto" />
            <p>Made for print and xerox shops.</p>
            <nav className="flex gap-5 sm:ml-auto">
              <Link href="/download" className="hover:text-ink">Download</Link>
              <Link href="/login" className="hover:text-ink">Sign in</Link>
              <Link href="/onboarding" className="hover:text-ink">Set up your shop</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
