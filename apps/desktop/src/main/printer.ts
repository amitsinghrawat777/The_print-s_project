import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { PrintRequest, PrintResult } from '../ipc';
import { lpArgs, safeFileName, sumatraArgs } from './printArgs';

/** Big enough for 500 pages of scans. Larger requests are refused. */
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const PRINT_TIMEOUT_MS = 3 * 60_000;
/** One app instance runs at a time (single-instance lock), so a fixed name is safe. */
const PRINT_TEMP_DIR = 'prints-desktop-spool';

/**
 * Set PRINTS_PRINT_DRY_RUN=1 to save PDFs to a folder instead of printing.
 * Used by the automated checks and for demos without a printer.
 */
const dryRun = process.env.PRINTS_PRINT_DRY_RUN === '1';

/** Where the bundled SumatraPDF lives (see scripts/fetch-sumatra.mjs). */
export function findSumatra(): string | null {
  const candidates = [
    app.isPackaged ? join(process.resourcesPath, 'bin', 'SumatraPDF.exe') : join(app.getAppPath(), 'resources', 'bin', 'SumatraPDF.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'SumatraPDF', 'SumatraPDF.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'SumatraPDF', 'SumatraPDF.exe'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: PRINT_TIMEOUT_MS, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

/**
 * Sends one PDF to the OS print spooler. The file is written to a private temp
 * folder with owner-only permissions and deleted as soon as the spooler has it.
 */
export async function printPdf(req: PrintRequest, knownPrinters: string[]): Promise<PrintResult> {
  if (!(req.pdf instanceof Uint8Array) || !isPdf(req.pdf)) return { ok: false, error: 'That file is not a PDF.' };
  if (req.pdf.byteLength > MAX_PDF_BYTES) return { ok: false, error: 'That file is too large to print.' };
  if (!Number.isInteger(req.copies) || req.copies < 1 || req.copies > 50) return { ok: false, error: 'Copies must be 1 to 50.' };
  if (!['A4', 'A3', 'Legal', 'Letter'].includes(req.paperSize)) return { ok: false, error: 'Unknown paper size.' };
  if (!dryRun && !knownPrinters.includes(req.printer)) {
    return { ok: false, error: `Printer "${req.printer}" was not found. Check Settings.` };
  }

  const options = { printer: req.printer, copies: req.copies, duplex: !!req.duplex, color: !!req.color, paperSize: req.paperSize };

  if (dryRun) {
    const dir = join(app.getPath('userData'), 'print-dry-run');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${safeFileName(req.label)}.pdf`);
    await writeFile(file, req.pdf);
    await writeFile(`${file}.json`, JSON.stringify({ ...options, label: req.label }, null, 2));
    console.log(`[print] dry run → ${file}`);
    return { ok: true, dryRunFile: file };
  }

  const dir = join(app.getPath('temp'), PRINT_TEMP_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${randomUUID()}.pdf`);
  try {
    await writeFile(file, req.pdf, { mode: 0o600 });
    if (process.platform === 'win32') {
      const sumatra = findSumatra();
      if (!sumatra) return { ok: false, error: 'The print engine (SumatraPDF) is missing. Reinstall the app.' };
      await run(sumatra, sumatraArgs(file, options));
    } else {
      await run('lp', lpArgs(file, options));
    }
    console.log(`[print] spooled ${req.label} → ${req.printer} (${req.copies}x, ${options.duplex ? 'duplex' : 'simplex'}, ${options.color ? 'colour' : 'mono'})`);
    return { ok: true };
  } catch (error) {
    console.error('[print] failed', error);
    return { ok: false, error: `The printer did not accept the file: ${(error as Error).message}` };
  } finally {
    await rm(file, { force: true });
  }
}

/** The OS default printer's name (Electron no longer reports it), or null. */
export async function defaultPrinterName(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const out = await capture('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '(Get-CimInstance Win32_Printer -Filter "Default=TRUE" | Select-Object -First 1).Name',
      ]);
      return out.trim() || null;
    }
    const out = await capture('lpstat', ['-d']); // "system default destination: HP_LaserJet"
    return out.split(':').slice(1).join(':').trim() || null;
  } catch {
    return null;
  }
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15_000, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** Removes temp folders left behind if the app ever crashed mid-print. */
export async function cleanPrintTemp(): Promise<void> {
  await rm(join(app.getPath('temp'), PRINT_TEMP_DIR), { recursive: true, force: true });
}
