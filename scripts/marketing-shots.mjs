#!/usr/bin/env node
// Takes the product screenshots for the website (apps/site/public/shots) with real-looking content.
// It makes a throwaway showcase shop with a full rate card and a day of orders, takes the
// customer's phone screens and the desktop app screens, then deletes the shop, its files and its
// owner. The demo-xerox shop is not touched.
//
// Needs Supabase, the processor and the customer app running, and a desktop build:
//   npm run build -w @prints/desktop && npm run marketing-shots
// WEB_URL picks the customer app (default http://localhost:3030).
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { _electron as electron, chromium } from 'playwright';
import { assignment, labReport, photo, resume } from './showcase-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const WEB = process.env.WEB_URL ?? 'http://localhost:3030';
const OUT = join(root, 'apps/site/public/shots');
mkdirSync(OUT, { recursive: true });

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, everyMs = 500) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value || Date.now() - start > timeoutMs) return value;
    await sleep(everyMs);
  }
}
const step = (text) => console.log(`  · ${text}`);

// --- files -----------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'prints-showcase-'));
const FILES = {
  'Pendulum Lab Report.pdf': await labReport(),
  'Resume - Rahul Verma.pdf': await resume(),
  'Assignment 3 - Linked Lists.pdf': await assignment(),
  'Mussoorie trip.png': photo(),
};
for (const [name, data] of Object.entries(FILES)) writeFileSync(join(dir, name), data);

// --- the showcase shop ---------------------------------------------------------
const stamp = Date.now();
const email = `showcase-${stamp}@test.local`;
const password = `pw-${stamp}-${Math.random().toString(36).slice(2)}`;
const slug = `showcase-${stamp.toString(36)}`;
const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (userErr) throw userErr;
const userId = user.user.id;
let shopId;

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-job-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Places an order through the customer API. `pick(fileId, name)` returns that file's print options. */
async function order(customerName, names, pick, note = '') {
  const { jobId, accessToken: token } = (await api('/api/jobs', { method: 'POST', body: { slug } })).body;
  const ids = {};
  for (const name of names) {
    const data = FILES[name];
    const reg = (await api(`/api/jobs/${jobId}/files`, { token, method: 'POST', body: { name, size: data.length } })).body;
    ids[name] = reg.file.id;
    await fetch(reg.upload.url, { method: 'PUT', headers: { 'content-type': reg.upload.contentType }, body: data });
    await api(`/api/jobs/${jobId}/files/${reg.file.id}/complete`, { token, method: 'POST' });
  }
  await waitFor(async () => (await api(`/api/jobs/${jobId}`, { token })).body.job.files.every((f) => f.status === 'ready'), 60_000);
  const files = names.map((name) => ({ fileId: ids[name], copies: 1, sides: 'single', paperSize: 'A4', colorPages: [], ...pick(name) }));
  // ask the server for the price instead of repeating the pricing rules here
  let sent = await api(`/api/jobs/${jobId}/submit`, { token, method: 'POST', body: { customerName, note, files, clientTotalPaise: 0 } });
  if (sent.status === 409) {
    const total = JSON.stringify(sent.body).match(/"totalPaise":(\d+)/)?.[1];
    sent = await api(`/api/jobs/${jobId}/submit`, { token, method: 'POST', body: { customerName, note, files, clientTotalPaise: Number(total) } });
  }
  if (sent.status !== 200) throw new Error(`submit failed for ${customerName}: ${JSON.stringify(sent.body)}`);
  await waitFor(async () => (await admin.from('jobs').select('status').eq('id', jobId).single()).data?.status === 'new', 60_000);
  return jobId;
}
const moveTo = async (jobId, ...statuses) => {
  for (const s of statuses) {
    const patch = s === 'done' ? { status: s, paid_at_counter: true } : { status: s };
    const { error } = await admin.from('jobs').update(patch).eq('id', jobId);
    if (error) throw new Error(`${s}: ${error.message}`);
  }
};

const userData = mkdtempSync(join(tmpdir(), 'prints-showcase-app-'));
let browser;
let app;
try {
  console.log('Showcase shop');
  const { data: shop, error: shopErr } = await admin
    .from('shops')
    .insert({ owner_id: userId, name: 'Sharma Xerox & Print', slug, address: 'Near College Gate, Dehradun', duplex_available: true, paper_sizes: ['A4', 'A3'] })
    .select('id')
    .single();
  if (shopErr) throw shopErr;
  shopId = shop.id;
  const prices = { A4: [200, 1000, 300, 1800], A3: [400, 2000, 600, 3600] };
  const combos = [['bw', 'single'], ['color', 'single'], ['bw', 'double'], ['color', 'double']];
  await admin.from('shop_rates').insert(
    Object.entries(prices).flatMap(([paper, p]) =>
      combos.map(([color_mode, sides], i) => ({ shop_id: shopId, paper_size: paper, color_mode, sides, price_paise: p[i] })),
    ),
  );

  console.log('Orders through the day');
  const all = (name) => ({ 'Pendulum Lab Report.pdf': [1, 2, 3, 4], 'Resume - Rahul Verma.pdf': [1], 'Assignment 3 - Linked Lists.pdf': [1, 2], 'Mussoorie trip.png': [1] })[name];
  const sneha = await order('Sneha', ['Mussoorie trip.png'], () => ({ pageSequence: [1], colorPages: [1], copies: 4 }));
  const karan = await order('Karan', ['Assignment 3 - Linked Lists.pdf'], (n) => ({ pageSequence: all(n), copies: 2 }));
  const arjun = await order('Arjun', ['Resume - Rahul Verma.pdf', 'Mussoorie trip.png'], (n) => ({ pageSequence: all(n), colorPages: n.endsWith('.png') ? [1] : [] }));
  await order('Priya', ['Pendulum Lab Report.pdf', 'Mussoorie trip.png'], (n) =>
    n.endsWith('.pdf') ? { pageSequence: [1, 2, 3, 4], colorPages: [3], copies: 2 } : { pageSequence: [1], colorPages: [1], paperSize: 'A3' },
  'Please staple the report');
  await order('Rahul', ['Resume - Rahul Verma.pdf'], () => ({ pageSequence: [1], copies: 5 }));
  await order('Neha', ['Assignment 3 - Linked Lists.pdf'], () => ({ pageSequence: [1, 2], sides: 'double' }));
  await moveTo(sneha, 'done');
  await moveTo(karan, 'done');
  await moveTo(arjun, 'printing', 'ready');
  step('6 orders: 2 collected, 1 ready, 3 to print');

  console.log('Customer phone');
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  // no Next.js dev badge in product shots
  await page.addInitScript(() => {
    const style = () => document.head?.insertAdjacentHTML('beforeend', '<style>nextjs-portal{display:none!important}</style>');
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', style) : style();
  });
  const shot = (name) => page.screenshot({ path: join(OUT, name), caret: 'initial', animations: 'disabled' });
  await page.goto(`${WEB}/s/${slug}`);
  await page.waitForLoadState('networkidle');
  // a file picked before React has hydrated the page is ignored, so pick again if nothing shows up
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('input[type=file]').setInputFiles([join(dir, 'Pendulum Lab Report.pdf'), join(dir, 'Mussoorie trip.png')]);
    if (await page.locator('article').first().waitFor({ timeout: 8_000 }).then(() => true, () => false)) break;
  }
  await page.getByText('4 pages ·').waitFor({ timeout: 60_000 });
  await page.getByText('1 page ·').waitFor({ timeout: 60_000 });
  // thumbnails draw as they scroll into view
  await page.locator('canvas:not(.invisible)').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await shot('phone-files.png');
  step('files added');

  const report = page.locator('article').filter({ hasText: 'Pendulum Lab Report.pdf' });
  await report.getByRole('button', { name: 'Mixed' }).click();
  await report.getByRole('button', { name: 'Page 3 in black and white' }).click();
  await report.getByRole('button', { name: 'More copies' }).click();
  const pic = page.locator('article').filter({ hasText: 'Mussoorie trip.png' });
  await pic.getByRole('button', { name: 'Colour' }).click();
  // the page thumbnails with their B&W / Colour labels at the top, the choices below
  await report.getByPlaceholder('All 4 pages').evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 24));
  await page.waitForTimeout(600);
  await shot('phone-customise.png');
  step('pages, colour and copies chosen');

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Your order').waitFor();
  await page.getByLabel('Your name').fill('Ananya');
  await page.getByRole('button', { name: 'Send to shop' }).click();
  await page.waitForURL(/\/j\//, { timeout: 30_000 });
  await page.getByText('Sent to the shop').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await shot('phone-status.png');
  step('sent, with a token');
  await browser.close();
  browser = undefined;

  console.log('Desktop app');
  const require = createRequire(import.meta.url);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env;
  app = await electron.launch({
    executablePath: require('electron'),
    args: [join(root, 'apps/desktop')],
    env: { ...cleanEnv, PRINTS_PRINT_DRY_RUN: '1', PRINTS_USER_DATA: userData },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 820 });
  await win.getByLabel('Email').fill(email);
  await win.getByLabel('Password').fill(password);
  await win.getByRole('button', { name: 'Sign in' }).click();
  await win.getByTestId('connection').filter({ hasText: 'Live' }).waitFor({ timeout: 20_000 });
  const desk = (name) => win.screenshot({ path: join(OUT, name), animations: 'disabled' });
  const openOrder = async (who) => {
    await win.getByRole('button', { name: new RegExp(`#\\d+.*${who}`) }).click();
    await win.locator('[data-testid="pdf-page"] canvas.opacity-100').first().waitFor({ timeout: 20_000 });
    await win.waitForTimeout(1500);
  };

  // hero: Priya's report, scrolled to the colour graph page
  await openOrder('Priya');
  await win.locator('[data-testid="pdf-page"]').nth(2).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await win.locator('[data-testid="pdf-page"] canvas.opacity-100').nth(2).waitFor({ timeout: 20_000 });
  await win.waitForTimeout(800);
  await desk('desktop-order.png');
  step('order with preview');

  // the queue: Rahul's CV open, collected orders listed
  await openOrder('Rahul');
  await win.locator('button[aria-expanded="false"]').filter({ hasText: /Collected/ }).click().catch(() => {});
  await win.waitForTimeout(500);
  await desk('desktop-queue.png');
  step('queue');

  // the rate card is small: a compact window keeps the shot from being mostly empty
  await win.setViewportSize({ width: 1180, height: 460 });
  await win.getByRole('button', { name: 'Rate card' }).click();
  await win.getByLabel('A4 B&W, one side').waitFor({ timeout: 10_000 });
  await win.waitForTimeout(400);
  await desk('desktop-rates.png');
  step('rate card');
  console.log(`\nScreenshots saved to ${OUT}`);
} catch (error) {
  // what the screen looked like when it went wrong
  const where = join(tmpdir(), `prints-showcase-error-${stamp}.png`);
  const open = app ? await app.firstWindow().catch(() => null) : browser?.contexts()[0]?.pages()[0];
  await open?.screenshot({ path: where }).then(() => console.error(`Screenshot of the failure: ${where}`)).catch(() => {});
  throw error;
} finally {
  await app?.close().catch(() => {});
  await browser?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  if (shopId) await removeFiles(`${shopId}`);
  // deleting the owner deletes the shop, its prices and its orders (on delete cascade)
  await admin.auth.admin.deleteUser(userId);
}

/** Deletes everything under a storage folder (the shop's uploads and print files). */
async function removeFiles(prefix) {
  const bucket = admin.storage.from('jobs'); // STORAGE_BUCKET in packages/shared
  const walk = async (path) => {
    const { data } = await bucket.list(path, { limit: 1000 });
    const out = [];
    for (const item of data ?? []) {
      const full = `${path}/${item.name}`;
      if (item.id) out.push(full);
      else out.push(...(await walk(full)));
    }
    return out;
  };
  const paths = await walk(prefix);
  if (paths.length) await bucket.remove(paths);
}
