// The only things the renderer can ask the main process to do. Shared by main,
// preload and renderer so all three agree on names and shapes.

export const IPC = {
  sessionGet: 'session:get',
  sessionSet: 'session:set',
  sessionRemove: 'session:remove',
  listPrinters: 'printers:list',
  print: 'print:run',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  queueChanged: 'queue:changed',
  newJob: 'queue:new-job',
  openJob: 'queue:open-job',
  oauthPrepare: 'oauth:prepare',
  oauthRun: 'oauth:run',
  oauthCancel: 'oauth:cancel',
} as const;

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export type PrintPaper = 'A4' | 'A3' | 'Legal' | 'Letter';

export interface PrintRequest {
  /** The print-ready PDF. Must start with %PDF-. */
  pdf: Uint8Array;
  printer: string;
  copies: number;
  duplex: boolean;
  color: boolean;
  paperSize: PrintPaper;
  /** Shown in logs and dry-run file names, e.g. "#12 Report.pdf (B&W)". */
  label: string;
}

export type PrintResult = { ok: true; dryRunFile?: string } | { ok: false; error: string };

export interface DesktopSettings {
  /** Printer for B&W parts; null means the system default printer. */
  bwPrinter: string | null;
  /** Printer for colour parts; null means the system default printer. */
  colorPrinter: string | null;
  openAtLogin: boolean;
  playSound: boolean;
}

/** What came back from the browser after Google sign-in. */
export type OAuthResult = { ok: true; code: string } | { ok: false; error: string };

export interface NewJobNotice {
  jobId: string;
  token: string;
  summary: string;
}

/** What `window.prints` looks like in the renderer. */
export interface PrintsBridge {
  session: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  listPrinters(): Promise<PrinterInfo[]>;
  print(request: PrintRequest): Promise<PrintResult>;
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  /** Updates the tray and taskbar with the number of orders waiting. */
  queueChanged(waiting: number): void;
  /** Shows a system notification and flashes the taskbar for a new order. */
  newJob(notice: NewJobNotice): void;
  /** Called when the owner clicks a notification. Returns an unsubscribe function. */
  onOpenJob(callback: (jobId: string) => void): () => void;
  /** Google sign-in: starts the one-time callback server, returns the redirect address. */
  oauthPrepare(): Promise<string>;
  /** Opens the sign-in page in the browser and waits for it to come back with a code. */
  oauthRun(authorizeUrl: string): Promise<OAuthResult>;
  oauthCancel(): void;
  platform: 'win32' | 'darwin' | 'linux';
}
