#!/usr/bin/env node
// Clicks through the customer screens in a phone-sized Chrome and saves
// screenshots. Needs the same running services as the smoke test.
//   npm run ui-check            (screenshots go to ./screenshots, which git ignores)
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { reportPdf, twoPageDocx } from './fixtures.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:3030';
const OUT = process.env.SCREENSHOT_DIR ?? 'screenshots';
mkdirSync(OUT, { recursive: true });

const dir = join(tmpdir(), `prints-ui-${Date.now()}`);
mkdirSync(dir);
writeFileSync(join(dir, 'Report.pdf'), await reportPdf(5));
writeFileSync(join(dir, 'Notes.docx'), twoPageDocx());

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(e.message));
// caret: 'initial' stops Playwright styling inputs before React hydrates them
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, caret: 'initial' });
const total = () => page.locator('.fixed p.text-xl').innerText();

try {
  console.log(`Customer screens at ${WEB} (390×844)`);
  await page.goto(`${WEB}/s/demo-xerox`);
  await page.getByText('Choose files to print').waitFor();
  await shot('1-shop');
  check(true, 'shop page opens');

  await page.locator('input[type=file]').setInputFiles([join(dir, 'Report.pdf'), join(dir, 'Notes.docx')]);
  await page.getByText('5 pages ·').waitFor({ timeout: 60_000 });
  await page.getByText('2 pages ·').waitFor({ timeout: 60_000 });
  // let the thumbnails draw
  await page.locator('canvas:not(.invisible)').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  check(true, 'both files uploaded and counted');
  check((await total()) === '₹14', 'live total for all pages, B&W', await total());
  await shot('2-files');

  const report = page.locator('article').filter({ hasText: 'Report.pdf' });
  await report.getByPlaceholder('All 5 pages').fill('1-3');
  await report.getByRole('button', { name: 'Mixed' }).click();
  await report.getByRole('button', { name: 'Page 2 in black and white' }).click();
  await report.getByRole('button', { name: 'More copies' }).click();
  // (2 × ₹2 + ₹10) × 2 = ₹28, plus Notes 2 × ₹2 = ₹4
  check((await total()) === '₹32', 'pages 1-3, page 2 colour, 2 copies', await total());

  const notes = page.locator('article').filter({ hasText: 'Notes.docx' });
  await notes.getByRole('button', { name: 'Both sides' }).click();
  check((await total()) === '₹31', 'Word file on both sides', await total());

  await report.getByPlaceholder('All 5 pages').fill('1-9');
  check(await report.getByText("Page 9 doesn't exist").isVisible(), 'bad page range explained');
  check(await page.getByRole('button', { name: 'Continue' }).isDisabled(), 'cannot continue with a bad range');
  await report.getByPlaceholder('All 5 pages').fill('3-1');
  check(await report.locator('span.rounded-full', { hasText: /^1$/ }).first().isVisible(), 'reverse order shows print positions');
  await shot('3-customised');

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Your order').waitFor();
  check(await page.getByText('Total, pay at the counter').isVisible(), 'review screen');
  await page.getByLabel('Your name').fill('Ravi');
  await page.getByLabel(/Note for the shop/).fill('Staple please');
  await shot('4-review');

  await page.getByRole('button', { name: 'Send to shop' }).click();
  await page.waitForURL(/\/j\//, { timeout: 30_000 });
  await page.getByText('Sent to the shop').waitFor({ timeout: 60_000 });
  const token = await page.locator('section p.text-7xl').innerText();
  check(/^#\d+$/.test(token), 'status page shows the token', token);
  check(await page.getByText('Pay ₹31 at the counter').isVisible(), 'status page shows the amount');
  await shot('5-status');

  await page.reload();
  await page.getByText('Sent to the shop').waitFor();
  check(true, 'status survives a refresh');

  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherPage = await other.newPage();
  await otherPage.goto(page.url());
  check(
    await otherPage
      .getByText('Open this page on the phone you ordered from')
      .waitFor({ timeout: 10_000 })
      .then(() => true, () => false),
    'another phone cannot see the order',
  );
  await other.close();
} catch (error) {
  failures++;
  console.error(error);
  await shot('error').catch(() => {});
} finally {
  check(consoleErrors.length === 0, 'no browser console errors', consoleErrors.join(' | ').slice(0, process.env.VERBOSE ? 5000 : 300));
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed. Screenshots in ${OUT}/` : `\nAll checks passed. Screenshots in ${OUT}/`);
process.exit(failures ? 1 : 0);
