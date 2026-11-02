import { crc32, deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { signedHeaders } from '@prints/shared';
import { detectFileType, extractPages, imageToPdf, inspectPdf, RejectedFileError } from './pdf';
import { buildServer } from './server';
import type { Worker } from './work';

/** A solid grey PNG of the given size. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter byte
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PDF whose page N is N×100 points wide, so page order is easy to check. */
async function numberedPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= pages; n++) doc.addPage([n * 100, 500]);
  return doc.save();
}

describe('detectFileType', () => {
  it('trusts the bytes over the file name', async () => {
    expect((await detectFileType(await numberedPdf(1), 'pdf')).kind).toBe('pdf');
    expect((await detectFileType(png(2, 2), 'jpg')).ext).toBe('png');
  });

  it('rejects files that are not printable documents', async () => {
    await expect(detectFileType(new TextEncoder().encode('hello'), 'pdf')).rejects.toThrow(RejectedFileError);
    const exe = new Uint8Array(512);
    exe.set([0x4d, 0x5a]);
    await expect(detectFileType(exe, 'docx')).rejects.toThrow(/isn't supported/);
  });
});

describe('inspectPdf', () => {
  it('counts pages', async () => {
    expect(await inspectPdf(await numberedPdf(7))).toEqual({ pageCount: 7 });
  });

  it('rejects damaged files', async () => {
    await expect(inspectPdf(new TextEncoder().encode('%PDF-1.7 garbage'))).rejects.toThrow(/damaged/);
  });
});

describe('imageToPdf', () => {
  it('fits a tall image on a portrait A4 page', async () => {
    const doc = await PDFDocument.load(await imageToPdf(png(300, 600), 'png'));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('turns the page for a wide image', async () => {
    const doc = await PDFDocument.load(await imageToPdf(png(600, 300), 'png'));
    expect(Math.round(doc.getPage(0).getSize().width)).toBe(842);
  });

  it('turns phone photos upright (EXIF orientation)', async () => {
    // stored 1000x600 landscape, EXIF orientation 6 = rotate 90° so it displays portrait
    const jpg = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#00f' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const page = (await PDFDocument.load(await imageToPdf(new Uint8Array(jpg), 'jpg'))).getPage(0);
    expect(page.getHeight()).toBeGreaterThan(page.getWidth());
  });

  it('rejects broken images', async () => {
    await expect(imageToPdf(new Uint8Array([1, 2, 3]), 'jpg')).rejects.toThrow(/damaged/);
  });
});

describe('extractPages', () => {
  it('copies pages in the requested order, including repeats', async () => {
    const source = await PDFDocument.load(await numberedPdf(5));
    const out = await PDFDocument.load(await extractPages(source, [3, 1, 1, 5]));
    expect(out.getPages().map((p) => p.getWidth())).toEqual([300, 100, 100, 500]);
  });
});

describe('server', () => {
  const secret = 'test-secret-that-is-long-enough';
  const fakeWorker = () =>
    ({
      processFile: vi.fn(async () => {}),
      buildJob: vi.fn(async () => {}),
      purgeOldJobs: vi.fn(async () => 3),
      retryStuckWork: vi.fn(async () => {}),
    }) satisfies Worker;

  it('refuses unsigned and wrongly signed requests', async () => {
    const worker = fakeWorker();
    const app = buildServer(worker, secret, { logger: false });
    const payload = JSON.stringify({ fileId: '0d6f3f2e-9c1a-4b8e-8f43-2d6f0b1c9a10' });

    const unsigned = await app.inject({ method: 'POST', url: '/process-file', payload, headers: { 'content-type': 'application/json' } });
    expect(unsigned.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/process-file',
      payload,
      headers: { 'content-type': 'application/json', ...(await signedHeaders('another-secret-entirely', payload)) },
    });
    expect(wrong.statusCode).toBe(401);
    expect(worker.processFile).not.toHaveBeenCalled();
  });

  it('accepts signed requests and starts the work', async () => {
    const worker = fakeWorker();
    const app = buildServer(worker, secret, { logger: false });
    const fileId = '0d6f3f2e-9c1a-4b8e-8f43-2d6f0b1c9a10';
    const payload = JSON.stringify({ fileId });
    const res = await app.inject({
      method: 'POST',
      url: '/process-file',
      payload,
      headers: { 'content-type': 'application/json', ...(await signedHeaders(secret, payload)) },
    });
    expect(res.statusCode).toBe(202);
    expect(worker.processFile).toHaveBeenCalledWith(fileId);

    const cleanupBody = '{}';
    const cleanup = await app.inject({
      method: 'POST',
      url: '/cleanup',
      payload: cleanupBody,
      headers: { 'content-type': 'application/json', ...(await signedHeaders(secret, cleanupBody)) },
    });
    expect(cleanup.json()).toEqual({ purged: 3 });
  });

  it('rejects bad bodies', async () => {
    const app = buildServer(fakeWorker(), secret, { logger: false });
    const payload = JSON.stringify({ fileId: 'not-a-uuid' });
    const res = await app.inject({
      method: 'POST',
      url: '/process-file',
      payload,
      headers: { 'content-type': 'application/json', ...(await signedHeaders(secret, payload)) },
    });
    expect(res.statusCode).toBe(400);
  });
});
