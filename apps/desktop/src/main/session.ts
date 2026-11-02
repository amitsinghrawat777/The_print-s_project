import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';

/**
 * Storage for the Supabase login (the renderer's auth `storage` adapter calls
 * this over IPC). It is encrypted with the OS keychain (DPAPI on Windows,
 * Keychain on macOS). If encryption isn't available the login is kept in
 * memory only and the owner signs in again next time.
 */
const MAX_KEYS = 20;
const MAX_VALUE = 64 * 1024;

let cache: Promise<Record<string, string>> | null = null;

function file() {
  return join(app.getPath('userData'), 'session.bin');
}

function load(): Promise<Record<string, string>> {
  cache ??= (async () => {
    try {
      if ((await safeStorage.isAsyncEncryptionAvailable()) && existsSync(file())) {
        const { result } = await safeStorage.decryptStringAsync(await readFile(file()));
        return JSON.parse(result) as Record<string, string>;
      }
    } catch (error) {
      console.warn('[session] could not read the saved login; signing out', error);
    }
    return {};
  })();
  return cache;
}

let writing: Promise<void> = Promise.resolve();
function persist(data: Record<string, string>) {
  const snapshot = JSON.stringify(data);
  writing = writing.then(async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return;
    const encrypted = await safeStorage.encryptStringAsync(snapshot);
    const tmp = `${file()}.tmp`;
    await writeFile(tmp, encrypted, { mode: 0o600 });
    await rename(tmp, file());
  });
  return writing;
}

function checkKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 100) throw new Error('bad session key');
}

export const sessionStore = {
  async get(key: unknown): Promise<string | null> {
    checkKey(key);
    return (await load())[key] ?? null;
  },
  async set(key: unknown, value: unknown): Promise<void> {
    checkKey(key);
    if (typeof value !== 'string' || value.length > MAX_VALUE) throw new Error('bad session value');
    const data = await load();
    if (!(key in data) && Object.keys(data).length >= MAX_KEYS) throw new Error('too many session keys');
    data[key] = value;
    await persist(data);
  },
  async remove(key: unknown): Promise<void> {
    checkKey(key);
    const data = await load();
    delete data[key];
    await persist(data);
  },
};
