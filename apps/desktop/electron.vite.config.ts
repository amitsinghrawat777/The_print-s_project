import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Writes the Content-Security-Policy into index.html. The renderer may only talk
 * to our own files and the configured Supabase project (REST, Storage, Realtime).
 */
function contentSecurityPolicy(mode: string): Plugin {
  const env = loadEnv(mode, __dirname, 'RENDERER_VITE_');
  const supabase = new URL(env.RENDERER_VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  const realtime = `${supabase.protocol === 'https:' ? 'wss:' : 'ws:'}//${supabase.host}`;
  const dev = mode === 'development';
  const policy = [
    "default-src 'self'",
    // the dev server injects React Fast Refresh as an inline module
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase.origin} ${realtime}${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
  return {
    name: 'prints-csp',
    transformIndexHtml: (html: string) => html.replace('__CSP__', policy),
  };
}

export default defineConfig(({ mode }) => ({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    envDir: __dirname,
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    plugins: [react(), tailwindcss(), contentSecurityPolicy(mode)],
  },
}));
