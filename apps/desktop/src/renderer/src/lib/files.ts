import { STORAGE_BUCKET } from '@prints/shared';
import { supabase } from './supabase';

/**
 * Print-ready PDFs, kept in memory only. Nothing is written to Downloads; the
 * bytes go straight to the viewer and, when printing, to the main process.
 */
const cache = new Map<string, Promise<Uint8Array>>();

export function loadPdfBytes(path: string): Promise<Uint8Array> {
  let entry = cache.get(path);
  if (!entry) {
    entry = supabase.storage
      .from(STORAGE_BUCKET)
      .download(path)
      .then(async ({ data, error }) => {
        if (error || !data) throw new Error(error?.message ?? 'Could not load the file');
        return new Uint8Array(await data.arrayBuffer());
      });
    entry.catch(() => cache.delete(path));
    cache.set(path, entry);
  }
  return entry;
}

/** Drops files of jobs that left the queue so memory doesn't grow all day. */
export function forgetPdfBytes(keepPaths: Set<string>) {
  for (const path of cache.keys()) if (!keepPaths.has(path)) cache.delete(path);
}
