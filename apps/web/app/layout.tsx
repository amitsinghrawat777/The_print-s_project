import type { Metadata, Viewport } from "next";
import Image from "next/image";
import mark from "../public/brand/mark.png";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "The Print's Project";

export const metadata: Metadata = {
  title: { default: `Send files to print · ${appName}`, template: `%s · ${appName}` },
  description: "Upload your files, choose pages and colour, see the price, and collect your prints. No WhatsApp, no pen drive.",
  icons: {
    // the P mark follows the browser theme: black on light tabs, white on dark
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
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <main className="mx-auto w-full max-w-lg flex-1 px-4 py-5">{children}</main>
        <footer className="flex justify-center pb-28">
          <Image src={mark} alt={appName} className="h-4 w-auto opacity-40" />
        </footer>
      </body>
    </html>
  );
}
