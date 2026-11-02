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
    /** The onboarding website (apps/site), linked from the "no shop yet" screen. */
    readonly RENDERER_VITE_SITE_URL?: string;
    /** '1' shows the email + password form (development and automated checks only). */
    readonly RENDERER_VITE_ALLOW_PASSWORD_LOGIN?: string;
  }
}

export {};
