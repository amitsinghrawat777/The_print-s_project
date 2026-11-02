#!/usr/bin/env node
// Clicks through the shop onboarding website (apps/site) as a brand-new owner:
// sign in, create a shop with prices, see the QR code and the dashboard.
// Needs Supabase (`npm run db:start`) and `npm run dev:site`. If the customer
// app is running too (`npm run dev:web`), it also checks the new shop's page there.
//   npm run site-check            (screenshots go to ./screenshots, which git ignores)
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = process.env.SITE_URL ?? 'http://localhost:3040';
const WEB = process.env.WEB_URL ?? 'http://localhost:3030';
const OUT = join(root, process.env.SCREENSHOT_DIR ?? 'screenshots');
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

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};

async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
}

// A fresh owner with no shop, like someone who just signed in with Google
const stamp = Date.now();
const email = `onboard-${stamp}@test.local`;
const password = `pw-${stamp}-${Math.random().toString(36).slice(2)}`;
const { data: created, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (userErr) throw userErr;
const userId = created.user.id;
const slug = `check-${stamp.toString(36)}`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const consoleErrors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => {
    // the taken-link test makes Supabase answer 409 on purpose
    if (m.type() === 'error' && !/status of 409/.test(m.text())) consoleErrors.push(m.text());
  });
  const shot = async (name, fullPage = true) => {
    // scroll through first so lazy images below the fold load
    if (fullPage) await scrollThrough(page);
    await page.screenshot({ path: join(OUT, `site-${name}.png`), fullPage, caret: 'initial' });
  };

  console.log('Public pages');
  await page.goto(SITE);
  check(await page.getByRole('heading', { level: 1 }).isVisible(), 'landing page shows its headline');
  await shot('1-landing');
  await page.goto(`${SITE}/download`);
  const download = page.locator('[data-testid="download"]:visible').first();
  await download.waitFor();
  check(await download.isVisible(), 'download page shows the installer buttons');
  await shot('2-download', false);

  console.log('Sign-in');
  await page.goto(`${SITE}/onboarding`);
  check(page.url().startsWith(`${SITE}/login`), 'signed-out visitors are sent to sign in', page.url());
  const googleButton = page.getByRole('button', { name: 'Continue with Google' });
  await googleButton.waitFor();
  check(await googleButton.isVisible(), 'Google sign-in is offered');
  await shot('3-login', false);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${SITE}/onboarding`);
  check(true, 'signed in and sent to the setup wizard');

  console.log('Wizard: shop');
  await page.locator('input[name="shop-name"]').fill('Check Print Centre');
  check((await page.locator('input[name="slug"]').inputValue()) === 'check-print-centre', 'link is made from the name');
  await shot('4-wizard-shop', false);
  // a link that's already taken comes back with a suggestion
  await page.locator('input[name="slug"]').fill('demo-xerox');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('create-shop').click();
  const taken = page.getByTestId('slug-problem');
  await taken.waitFor();
  check((await taken.innerText()).includes('demo-xerox-2'), 'a taken link is caught and a new one suggested', await taken.innerText());
  await page.locator('input[name="slug"]').fill(slug);
  await page.locator('input[name="address"]').fill('Station Road');
  await page.getByRole('button', { name: 'Continue' }).click();

  console.log('Wizard: prices');
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  check(focused === 'Paper and prices', 'focus moves to the new step’s heading', String(focused));
  await page.getByRole('button', { name: 'A3', exact: true }).click();
  await page.locator('input[name="duplex"]').check();
  await page.getByLabel('A4, B&W, one side, per page').fill('1.5');
  await page.getByLabel('A3, Colour, both sides, per sheet').fill('');
  await shot('5-wizard-prices');
  await page.getByTestId('create-shop').click();
  await page.getByTestId('qr').waitFor({ timeout: 15_000 });
  check(true, 'shop created and its QR code shown');
  const link = await page.getByTestId('customer-link').innerText();
  check(link.endsWith(`/s/${slug}`), 'the QR code points to the shop page', link);
  await shot('6-wizard-done');

  const { data: shop } = await admin.from('shops').select('id, owner_id, name, slug, address, duplex_available, paper_sizes').eq('slug', slug).single();
  check(shop?.owner_id === userId, 'the shop belongs to the new owner');
  check(shop?.duplex_available === true && shop?.paper_sizes.join() === 'A4,A3', 'paper sizes and both-sides saved', shop?.paper_sizes.join());
  const { data: rates } = await admin.from('shop_rates').select('paper_size, color_mode, sides, price_paise').eq('shop_id', shop?.id);
  check(rates?.length === 7, '7 prices saved (the blank one is left out)', String(rates?.length));
  const a4bw = rates?.find((r) => r.paper_size === 'A4' && r.color_mode === 'bw' && r.sides === 'single');
  check(a4bw?.price_paise === 150, 'edited price saved in paise', String(a4bw?.price_paise));

  const web = await fetch(`${WEB}/api/shops/${slug}`).catch(() => null);
  if (web) {
    const body = await web.json();
    check(web.status === 200 && body.shop?.name === 'Check Print Centre', 'customers can open the new shop in the customer app');
  } else {
    console.log('  - customer app not running, skipped its check');
  }

  console.log('Dashboard');
  await page.goto(`${SITE}/onboarding`);
  await page.waitForURL(`${SITE}/dashboard`);
  check(true, 'owners with a shop are sent to the dashboard');
  check((await page.getByTestId('shop-name').innerText()) === 'Check Print Centre', 'dashboard shows the shop');
  await shot('7-dashboard');

  console.log('Phone width');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  await mobile.goto(SITE);
  await scrollThrough(mobile);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'landing page fits a phone without sideways scrolling', `${overflow}px`);
  await mobile.screenshot({ path: join(OUT, 'site-8-landing-phone.png'), fullPage: true });
  await mobile.getByRole('button', { name: 'Open menu' }).click();
  const menu = mobile.locator('#mobile-menu');
  check(await menu.getByRole('link', { name: 'Features' }).isVisible(), 'phone menu opens with the page links');
  await mobile.screenshot({ path: join(OUT, 'site-9-phone-menu.png') });
  await mobile.keyboard.press('Escape');
  check(!(await menu.isVisible()), 'Escape closes the phone menu');
  await mobile.getByRole('button', { name: 'Open menu' }).click();
  await mobile.mouse.click(195, 760);
  check(!(await menu.isVisible()), 'tapping outside closes the phone menu');
  await mobile.getByRole('button', { name: 'Open menu' }).click();
  await menu.getByRole('link', { name: 'Download' }).click();
  await mobile.waitForURL(`${SITE}/download`);
  check(!(await menu.isVisible()), 'choosing a link goes there and closes the menu');
  await phone.close();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(`${SITE}/`);
  check(true, 'sign out returns to the home page');
} finally {
  await browser.close();
  // deleting the user deletes the shop and its prices too (on delete cascade)
  await admin.auth.admin.deleteUser(userId);
}

check(consoleErrors.length === 0, 'no errors in the browser console', consoleErrors.slice(0, 3).join(' | '));
console.log(failures ? `\n${failures} check(s) failed` : `\nAll site checks passed. Screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
