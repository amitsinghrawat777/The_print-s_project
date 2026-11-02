import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { DesktopSettings } from '../ipc';

const DEFAULTS: DesktopSettings = {
  bwPrinter: null,
  colorPrinter: null,
  openAtLogin: true,
  playSound: true,
};

let current: DesktopSettings | null = null;

function file() {
  return join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): DesktopSettings {
  if (current) return current;
  current = { ...DEFAULTS };
  try {
    if (existsSync(file())) current = { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<DesktopSettings>) };
  } catch (error) {
    console.warn('[settings] unreadable, using defaults', error);
  }
  return current;
}

function printerName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 ? value : null;
}

/** Only known keys with the right types are accepted from the renderer. */
export async function updateSettings(patch: unknown): Promise<DesktopSettings> {
  const p = (patch ?? {}) as Record<string, unknown>;
  const next = { ...getSettings() };
  if ('bwPrinter' in p) next.bwPrinter = printerName(p.bwPrinter);
  if ('colorPrinter' in p) next.colorPrinter = printerName(p.colorPrinter);
  if (typeof p.openAtLogin === 'boolean') next.openAtLogin = p.openAtLogin;
  if (typeof p.playSound === 'boolean') next.playSound = p.playSound;
  current = next;
  await writeFile(file(), JSON.stringify(next, null, 2));
  applyLoginItem(next);
  return next;
}

/** Start with the computer so new orders are never missed. Only for the installed app. */
export function applyLoginItem(settings: DesktopSettings) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: ['--hidden'] });
}
