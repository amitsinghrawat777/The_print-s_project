#!/usr/bin/env node
// End-to-end check of the customer flow against running local services:
//   npm run db:start && npm run services:up && npm run dev:processor && npm run dev:web
//   npm run smoke
// It plays the customer (through the public API) and the shop owner (logged in,
// through Supabase with RLS), then checks that old files get deleted.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { png, reportPdf, twoPageDocx } from './fixtures.mjs';

const WEB = process.env.WEB_URL ?? 'http://localhost:3030';
const PROCESSOR = process.env.PROCESSOR_URL ?? 'http://127.0.0.1:4000';
const SLUG = 'demo-xerox';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const status = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^{]*/, ''),
);

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-job-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ---------------------------------------------------------------- customer

console.log(`Customer flow against ${WEB}`);

const shopRes = await api(`/api/shops/${SLUG}`);
check(shopRes.status === 200 && shopRes.body.shop.rates.length > 0, 'shop page data loads', shopRes.body?.shop?.name);

const created = await api('/api/jobs', { method: 'POST', body: { slug: SLUG } });
check(created.status === 201, 'draft order created');
const { jobId, accessToken: token } = created.body;

const unsupported = await api(`/api/jobs/${jobId}/files`, { token, method: 'POST', body: { name: 'virus.exe', size: 10 } });
check(unsupported.status === 415, 'unsupported file type refused up front');

const fixtures = [
  { name: 'Report.pdf', data: await reportPdf(5) },
  { name: 'Photo.png', data: png(400, 300) },
  { name: 'Notes.docx', data: twoPageDocx() },
  { name: 'Fake.pdf', data: Buffer.from('this is not really a pdf') },
];
const ids = {};
for (const f of fixtures) {
  const reg = await api(`/api/jobs/${jobId}/files`, { token, method: 'POST', body: { name: f.name, size: f.data.length } });
  if (reg.status !== 201) {
    check(false, `register ${f.name}`, JSON.stringify(reg.body));
    continue;
  }
  ids[f.name] = reg.body.file.id;
  // what the browser does: a direct PUT of the bytes to the signed storage URL
  const put = await fetch(reg.body.upload.url, {
    method: 'PUT',
    headers: { 'content-type': reg.body.upload.contentType, 'x-upsert': 'false' },
    body: f.data,
  });
  check(put.ok, `upload ${f.name} straight to storage`, put.ok ? '' : `${put.status} ${await put.text()}`);
  await api(`/api/jobs/${jobId}/files/${reg.body.file.id}/complete`, { token, method: 'POST' });
}

let job;
const started = Date.now();
do {
  await sleep(1000);
  job = (await api(`/api/jobs/${jobId}`, { token })).body.job;
} while (job.files.some((f) => ['uploaded', 'processing', 'pending_upload'].includes(f.status)) && Date.now() - started < 120_000);

const byName = Object.fromEntries(job.files.map((f) => [f.name, f]));
check(byName['Report.pdf']?.status === 'ready' && byName['Report.pdf'].pageCount === 5, 'PDF counted', `${byName['Report.pdf']?.pageCount} pages`);
check(byName['Photo.png']?.status === 'ready' && byName['Photo.png'].pageCount === 1, 'photo turned into a 1-page PDF');
check(
  byName['Notes.docx']?.status === 'ready' && byName['Notes.docx'].pageCount === 2,
  'Word file converted by Gotenberg',
  byName['Notes.docx']?.error ?? `${byName['Notes.docx']?.pageCount} pages`,
);
check(byName['Fake.pdf']?.status === 'rejected', 'fake PDF rejected with a message', byName['Fake.pdf']?.error);
check(!!byName['Report.pdf']?.previewUrl, 'draft has a preview link');
const preview = await fetch(byName['Report.pdf'].previewUrl);
check(preview.ok && (await preview.arrayBuffer()).byteLength > 0, 'preview link serves the PDF');

const removed = await api(`/api/jobs/${jobId}/files/${ids['Fake.pdf']}`, { token, method: 'DELETE' });
check(removed.status === 204, 'customer removes the rejected file');

// Report: pages 1-3 with page 2 in colour, 2 copies → (2×₹2 + ₹10) × 2 = ₹28
// Photo: colour → ₹10.  Notes: both sides, B&W → 1 sheet ₹3.  Total ₹41.
const files = [
  { fileId: ids['Report.pdf'], pageSequence: [1, 2, 3], colorPages: [2], copies: 2, sides: 'single', paperSize: 'A4' },
  { fileId: ids['Photo.png'], pageSequence: [1], colorPages: [1], copies: 1, sides: 'single', paperSize: 'A4' },
  { fileId: ids['Notes.docx'], pageSequence: [1, 2], colorPages: [], copies: 1, sides: 'double', paperSize: 'A4' },
];
const stale = await api(`/api/jobs/${jobId}/submit`, {
  token,
  method: 'POST',
  body: { customerName: 'Ravi', note: 'Staple please', files, clientTotalPaise: 4000 },
});
check(
  stale.status === 409 && stale.body.error.code === 'PRICE_CHANGED' && stale.body.error.details.totalPaise === 4100,
  'server catches a wrong client price',
  `server says ₹${stale.body?.error?.details?.totalPaise / 100}`,
);
const badPage = await api(`/api/jobs/${jobId}/submit`, {
  token,
  method: 'POST',
  body: { customerName: 'Ravi', files: [{ ...files[0], pageSequence: [9] }, files[1], files[2]], clientTotalPaise: 0 },
});
check(badPage.status === 400, 'page numbers past the end are refused', badPage.body?.error?.message);

const submitted = await api(`/api/jobs/${jobId}/submit`, {
  token,
  method: 'POST',
  body: { customerName: 'Ravi', note: 'Staple please', files, clientTotalPaise: 4100 },
});
check(submitted.status === 200 && /^\d+$/.test(submitted.body.job.token), 'order sent', `token ${submitted.body.job?.token}`);
const resubmit = await api(`/api/jobs/${jobId}/submit`, {
  token,
  method: 'POST',
  body: { customerName: 'Ravi', files, clientTotalPaise: 4100 },
});
check(resubmit.status === 409, 'cannot send the same order twice');

const buildStart = Date.now();
do {
  await sleep(700);
  job = (await api(`/api/jobs/${jobId}`, { token })).body.job;
} while (job.status === 'building' && Date.now() - buildStart < 60_000);
check(job.status === 'new', 'print files built, order in the shop queue', job.statusLabel);
check(job.files.every((f) => f.previewUrl === null), 'no preview links once sent');

check((await api(`/api/jobs/${jobId}`)).status === 404, 'no token → not found');
check((await api(`/api/jobs/${jobId}`, { token: 'wrong' })).status === 404, 'wrong token → not found');

// ---------------------------------------------------------------- shop owner

console.log('Shop owner (RLS)');
const owner = createClient(status.API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
const login = await owner.auth.signInWithPassword({ email: 'owner@demo.test', password: 'demo-password' });
check(!login.error, 'owner logs in', login.error?.message);

const { data: queue } = await owner.from('jobs').select('id, token, status, total_paise').eq('id', jobId);
check(queue?.length === 1 && queue[0].total_paise === 4100, 'owner sees the order with its price');

const { data: ownerFiles } = await owner
  .from('job_files')
  .select('original_name, print_parts')
  .eq('job_id', jobId)
  .eq('status', 'ready')
  .order('position');
const expected = {
  'Report.pdf': [{ kind: 'color', mixed: true, pages: [1, 2, 3] }],
  'Photo.png': [{ kind: 'color', mixed: false, pages: [1] }],
  'Notes.docx': [{ kind: 'bw', mixed: false, pages: [1, 2] }],
};
for (const f of ownerFiles ?? []) {
  const parts = f.print_parts;
  const shape = parts.map(({ kind, mixed, pages }) => ({ kind, mixed, pages }));
  check(JSON.stringify(shape) === JSON.stringify(expected[f.original_name]), `${f.original_name} print plan`, JSON.stringify(shape));
  for (const part of parts) {
    const { data: blob, error } = await owner.storage.from('jobs').download(part.path);
    const pdf = blob && (await PDFDocument.load(await blob.arrayBuffer()));
    check(!error && pdf?.getPageCount() === part.pages.length, `  owner downloads ${part.kind} part`, `${pdf?.getPageCount()} pages`);
  }
}

const stranger = createClient(status.API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: anonJobs, error: anonError } = await stranger.from('jobs').select('id').eq('id', jobId);
check(!!anonError || anonJobs?.length === 0, 'logged-out clients see nothing');

for (const next of ['opened', 'printing', 'ready']) {
  const { error } = await owner.from('jobs').update({ status: next }).eq('id', jobId);
  check(!error, `owner marks it ${next}`, error?.message);
}
job = (await api(`/api/jobs/${jobId}`, { token })).body.job;
check(job.status === 'ready', 'customer sees it is ready', job.statusLabel);
const { error: doneError } = await owner.from('jobs').update({ status: 'done', paid_at_counter: true }).eq('id', jobId);
check(!doneError, 'owner marks it paid and done');

// ---------------------------------------------------------------- cleanup

console.log('File cleanup');
const admin = createClient(status.API_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
await admin.from('jobs').update({ done_at: new Date(Date.now() - 3 * 3600_000).toISOString() }).eq('id', jobId);
const body = '{}';
const ts = String(Math.floor(Date.now() / 1000));
const sig = createHmac('sha256', env.PROCESSOR_SECRET).update(`${ts}.${body}`).digest('hex');
const cleanup = await fetch(`${PROCESSOR}/cleanup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': sig },
  body,
});
check(cleanup.ok, 'processor cleanup runs', JSON.stringify(await cleanup.json()));
const { data: purged } = await admin.from('jobs').select('status, files_purged_at').eq('id', jobId).single();
check(!!purged.files_purged_at && purged.status === 'done', 'job marked purged, still done');
let leftover = 0;
for (const folder of ['original', 'pdf', 'print']) {
  const { data } = await admin.storage.from('jobs').list(`22222222-2222-4222-8222-222222222222/${jobId}/${folder}`);
  leftover += data?.length ?? 0;
}
check(leftover === 0, 'all files deleted from storage', `${leftover} left`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
