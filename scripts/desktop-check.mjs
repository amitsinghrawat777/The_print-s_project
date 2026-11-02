#!/usr/bin/env node
// Drives the shop owner desktop app (Electron) end to end against the running
// local stack, with printing in dry-run mode (PDFs are saved, not printed):
//   npm run build -w @prints/desktop && npm run desktop-check
// Needs everything from "Run it locally" in the README.
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { _electron as electron } from 'playwright';
import { png, reportPdf } from './fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const WEB = process.env.WEB_URL ?? 'http://localhost:3030';
const SLUG = 'demo-xerox';
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });

const env = Object.fromEntries(
  readFileSync(join(root, 'apps/web/.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const status = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^{]*/, ''),
);
const admin = createClient(status.API_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, everyMs = 300) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) return value;
    await sleep(everyMs);
  }
}
const jobStatus = async (id) => (await admin.from('jobs').select('status, paid_at_counter').eq('id', id).single()).data;

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-job-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Places an order as a customer: 3 B&W pages × 2 copies, plus a colour photo. */
async function placeOrder() {
  const { jobId, accessToken: token } = (await api('/api/jobs', { method: 'POST', body: { slug: SLUG } })).body;
  const ids = {};
  for (const f of [{ name: 'Report.pdf', data: await reportPdf(4) }, { name: 'Photo.png', data: png(400, 300) }]) {
    const reg = (await api(`/api/jobs/${jobId}/files`, { token, method: 'POST', body: { name: f.name, size: f.data.length } })).body;
    ids[f.name] = reg.file.id;
    await fetch(reg.upload.url, { method: 'PUT', headers: { 'content-type': reg.upload.contentType }, body: f.data });
    await api(`/api/jobs/${jobId}/files/${reg.file.id}/complete`, { token, method: 'POST' });
  }
  await waitFor(async () => (await api(`/api/jobs/${jobId}`, { token })).body.job.files.every((f) => f.status === 'ready'), 60_000, 700);
  const files = [
    { fileId: ids['Report.pdf'], pageSequence: [1, 2, 3], colorPages: [], copies: 2, sides: 'single', paperSize: 'A4' },
    { fileId: ids['Photo.png'], pageSequence: [1], colorPages: [1], copies: 1, sides: 'single', paperSize: 'A4' },
  ];
  // (3 × ₹2) × 2 + ₹10 = ₹22
  const sent = await api(`/api/jobs/${jobId}/submit`, { token, method: 'POST', body: { customerName: 'Desktop Check', files, clientTotalPaise: 2200 } });
  if (sent.status !== 200) throw new Error(`submit failed: ${JSON.stringify(sent.body)}`);
  return { jobId, token, orderToken: sent.body.job.token, sentAt: Date.now() };
}

const userData = mkdtempSync(join(tmpdir(), 'prints-desktop-check-'));
const require = createRequire(import.meta.url);
// Editors like VS Code set ELECTRON_RUN_AS_NODE for their child processes, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env;
const launch = () =>
  electron.launch({
    executablePath: require('electron'),
    args: [join(root, 'apps/desktop')],
    env: { ...cleanEnv, PRINTS_PRINT_DRY_RUN: '1', PRINTS_USER_DATA: userData },
  });

let app;
const consoleErrors = [];
const watchConsole = (page) => page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
try {
  console.log('Desktop app');
  app = await launch();
  let page = await app.firstWindow();
  watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 820 });

  await page.getByLabel('Email').fill('owner@demo.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const refused = await page.getByText('Wrong email or password.').waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(refused, 'wrong password is refused');

  await page.getByLabel('Password').fill('demo-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const shopName = await page.getByTestId('shop-name').textContent({ timeout: 15_000 }).catch(() => null);
  check(shopName === 'Sharma Xerox & Print', 'owner signs in and sees their shop', shopName ?? 'no shop');
  const live = await page.getByTestId('connection').filter({ hasText: 'Live' }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check(live, 'realtime connection is live');

  // A customer orders while the app is open; it must arrive without a refresh (the backup poll is 30 s).
  const order = await placeOrder();
  const row = page.getByRole('button', { name: new RegExp(`#${order.orderToken}\\b.*Desktop Check`) });
  const arrived = await row.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check(arrived, `new order #${order.orderToken} appears by itself`, `${((Date.now() - order.sentAt) / 1000).toFixed(1)} s after it was sent`);
  await page.screenshot({ path: join(shots, 'desktop-1-queue.png') });

  await row.click();
  check((await page.getByTestId('job-token').textContent()) === `#${order.orderToken}`, 'order opens');
  const opened = await waitFor(async () => (await jobStatus(order.jobId))?.status === 'opened', 10_000);
  check(opened, 'opening it marks it "opened" (customer sees the shop is looking)');
  const drawn = await page.locator('[data-testid="pdf-page"] canvas.opacity-100').first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check(drawn, 'preview draws the print-ready PDF in the app');
  check((await page.locator('[data-testid="pdf-page"]').count()) === 3, 'preview shows exactly the 3 pages that will print');
  await page.screenshot({ path: join(shots, 'desktop-2-order.png') });

  await page.getByTestId('print-all').click();
  const ready = await waitFor(async () => (await jobStatus(order.jobId))?.status === 'ready', 20_000);
  check(ready, 'Print all sends every part, then marks it ready');
  const customer = (await api(`/api/jobs/${order.jobId}`, { token: order.token })).body?.job;
  check(customer?.status === 'ready', 'customer status page sees it', customer?.statusLabel);

  const dryDir = join(userData, 'print-dry-run');
  const jobs = readdirSync(dryDir).filter((f) => f.endsWith('.json')).map((f) => ({ f, ...JSON.parse(readFileSync(join(dryDir, f), 'utf8')) }));
  const bw = jobs.find((j) => j.label.includes('Report.pdf'));
  const colour = jobs.find((j) => j.label.includes('Photo.png'));
  check(jobs.length === 2, 'two print jobs spooled', jobs.map((j) => j.label).join(' | '));
  check(bw && bw.copies === 2 && bw.color === false && bw.duplex === false && bw.paperSize === 'A4', 'B&W part: 2 copies, mono, one side, A4', JSON.stringify(bw && { c: bw.copies, color: bw.color }));
  check(colour && colour.copies === 1 && colour.color === true, 'colour part: 1 copy, colour');
  if (bw) {
    const pdf = await PDFDocument.load(readFileSync(join(dryDir, bw.f.replace(/\.json$/, ''))));
    check(pdf.getPageCount() === 3, 'B&W print file has the 3 chosen pages');
  }
  await page.screenshot({ path: join(shots, 'desktop-3-printed.png') });

  await page.getByTestId('finish').click();
  const done = await waitFor(async () => {
    const s = await jobStatus(order.jobId);
    return s?.status === 'done' && s.paid_at_counter;
  }, 10_000);
  check(done, '"Paid & collected" marks it paid and done');

  await page.getByRole('button', { name: 'Rate card' }).click();
  const a4 = await page.getByLabel('A4 B&W, one side').inputValue({ timeout: 10_000 }).catch(() => null);
  check(a4 === '2', 'rate card shows the shop prices', `A4 B&W ₹${a4}`);
  await page.screenshot({ path: join(shots, 'desktop-4-rates.png') });
  await page.getByRole('button', { name: 'Settings' }).click();
  const qr = await page.getByAltText(/QR code for/).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(qr, 'settings shows the shop QR code');
  await page.screenshot({ path: join(shots, 'desktop-5-settings.png'), fullPage: true });

  // The login is kept (encrypted) across restarts.
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  watchConsole(page);
  const stillIn = await page.getByTestId('shop-name').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check(stillIn, 'stays signed in after a restart');
  check(!readFileSync(join(userData, 'session.bin')).toString('latin1').includes('access_token'), 'saved login is encrypted on disk');
  // the wrong-password attempt logs a 400 from the auth server; anything else is a bug
  const unexpected = consoleErrors.filter((t) => !/status of 400/.test(t));
  check(unexpected.length === 0, 'no errors or CSP violations in the app console', unexpected.join(' | ').slice(0, 300));
} catch (error) {
  check(false, 'unexpected error', error.message);
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll desktop checks passed');
process.exit(failures ? 1 : 0);
