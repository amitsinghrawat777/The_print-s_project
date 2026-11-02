/// <reference types="vite/client" />
import type { PrintsBridge } from '../../ipc';

declare global {
  interface Window {
    prints: PrintsBridge;
  }
  interface ImportMetaEnv {
    readonly RENDERER_VITE_SUPABASE_URL: string;
    readonly RENDERER_VITE_SUPABASE_PUBLISHABLE_KEY: string;
    readonly RENDERER_VITE_WEB_URL: string;
  }
}

export {};
