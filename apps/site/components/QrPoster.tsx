'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { customerLink } from '@/lib/env';
import { Button, buttonClass } from './ui';

/**
 * The shop's QR code, with the same options as the desktop app's poster
 * (apps/desktop/src/renderer/src/components/Settings.tsx), so both print alike.
 */
export function QrPoster({ name, slug }: { name: string; slug: string }) {
  const link = customerLink(slug);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(link, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then((url) => live && setQr(url));
    return () => {
      live = false;
    };
  }, [link]);

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="size-44 shrink-0 rounded-2xl bg-white p-2 ring-1 ring-neutral-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL */}
        {qr && <img src={qr} alt={`QR code for ${link}`} className="size-full" data-testid="qr" />}
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <p className="text-sm text-neutral-500">Customers order at</p>
          <a href={link} target="_blank" rel="noreferrer" className="font-mono text-sm break-all text-accent hover:underline" data-testid="customer-link">
            {link}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="dark" size="sm" disabled={!qr} onClick={() => window.print()}>Print poster</Button>
          {qr ? (
            <a href={qr} download={`${slug}-qr.png`} className={buttonClass('light', 'sm')}>Download PNG</a>
          ) : (
            <Button variant="light" size="sm" disabled>Download PNG</Button>
          )}
          <Button variant="light" size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>

      {/* only this prints (see globals.css) */}
      <div id="qr-poster" className="hidden flex-col items-center justify-center gap-8 bg-white p-16 text-center text-black">
        <p className="text-5xl font-bold">{name}</p>
        <p className="text-3xl">Scan to print</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL */}
        {qr && <img src={qr} alt="" className="size-[420px]" />}
        <p className="text-xl">
          Upload your files, choose pages and colour, see the price.
          <br />
          No WhatsApp, no pen drive.
        </p>
        <p className="font-mono text-lg">{link}</p>
      </div>
    </div>
  );
}
