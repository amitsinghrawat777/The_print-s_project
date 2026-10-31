// Copies the pdf.js worker into public/ so the browser can load it from our own origin.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(publicDir, { recursive: true });
copyFileSync(join(pdfjsDir, 'legacy/build/pdf.worker.min.mjs'), join(publicDir, 'pdf.worker.min.mjs'));
