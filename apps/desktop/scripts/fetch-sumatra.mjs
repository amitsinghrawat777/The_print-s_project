#!/usr/bin/env node
// Downloads SumatraPDF (the Windows print engine) into resources/bin/.
// The archive is checked against a pinned SHA-256 before anything is extracted.
// To upgrade: change VERSION and SHA256 (sha256sum of the new zip).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '3.6.1';
const SHA256 = '98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544';
const URL_ = `https://www.sumatrapdfreader.org/dl/rel/${VERSION}/SumatraPDF-${VERSION}-64.zip`;

const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin');
const target = join(binDir, 'SumatraPDF.exe');

if (existsSync(target) && !process.argv.includes('--force')) {
  console.log(`SumatraPDF already present: ${target}`);
  process.exit(0);
}

console.log(`Downloading SumatraPDF ${VERSION}…`);
const res = await fetch(URL_);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const zip = Buffer.from(await res.arrayBuffer());
const hash = createHash('sha256').update(zip).digest('hex');
if (hash !== SHA256) throw new Error(`Checksum mismatch: expected ${SHA256}, got ${hash}. Not extracting.`);

const work = mkdtempSync(join(tmpdir(), 'sumatra-'));
try {
  writeFileSync(join(work, 'sumatra.zip'), zip);
  // Windows 10+ ships bsdtar, which reads zip files; macOS tar does too.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', 'sumatra.zip'], { cwd: work, stdio: 'inherit' });
  mkdirSync(binDir, { recursive: true });
  // copy, not rename: the temp folder may be on another drive
  copyFileSync(join(work, `SumatraPDF-${VERSION}-64.exe`), target);
  console.log(`Saved ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
