import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  Notification,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { IPC, type NewJobNotice, type PrintRequest } from '../ipc';
import { appIcon, badgeDot, trayIcon } from './icon';
import { cleanPrintTemp, defaultPrinterName, printPdf } from './printer';
import { sessionStore } from './session';
import { applyLoginItem, getSettings, updateSettings } from './settings';

const APP_NAME = "The Print's Project";
const TRAY_SIZE = process.platform === 'darwin' ? 18 : 32;
const devServer = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;

// Lets automated checks run against a throwaway profile.
if (process.env.PRINTS_USER_DATA) app.setPath('userData', resolve(process.env.PRINTS_USER_DATA));

// In production the UI is served from app://shop/ rather than file://, so it has
// a real origin (needed for the PDF.js worker) and a strict CSP.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let waiting = 0;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

async function start() {
  app.setAppUserModelId(app.isPackaged ? 'in.theprints.desktop' : process.execPath);
  Menu.setApplicationMenu(null);
  await cleanPrintTemp();
  applyLoginItem(getSettings());

  const rendererDir = join(__dirname, '../renderer');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const path = normalize(join(rendererDir, decodeURIComponent(url.pathname)));
    const rel = relative(rendererDir, path);
    if (url.host !== 'shop' || rel.startsWith('..') || isAbsolute(rel)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(path).toString());
  });

  // The renderer never needs camera, location, etc. It may only copy text (the shop link).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'));

  registerIpc();
  createTray();
  createWindow(!process.argv.includes('--hidden'));

  // Icons come in light and dark versions; swap them when the system theme changes.
  nativeTheme.on('updated', () => {
    win?.setIcon(appIcon(256));
    tray?.setImage(trayIcon(TRAY_SIZE, waiting > 0));
  });
}

function createWindow(show: boolean) {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    icon: appIcon(256),
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // the new-order chime must play without a click first
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.once('ready-to-show', () => {
    if (show) win?.show();
  });

  // Never navigate away from the app or open other windows; real links open in the browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing keeps the app in the tray so orders still arrive.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });

  if (devServer) void win.loadURL(devServer);
  else void win.loadURL('app://shop/index.html');
}

function isAppUrl(url: string) {
  return devServer ? url.startsWith(devServer) : url.startsWith('app://shop/');
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(trayIcon(TRAY_SIZE));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
}

function setWaiting(count: number) {
  waiting = count;
  const label = count === 0 ? 'No orders waiting' : `${count} order${count === 1 ? '' : 's'} waiting`;
  tray?.setToolTip(`${APP_NAME}: ${label}`);
  tray?.setImage(trayIcon(TRAY_SIZE, count > 0));
  if (process.platform === 'darwin') app.setBadgeCount(count);
  if (process.platform === 'win32') win?.setOverlayIcon(count > 0 ? badgeDot(16) : null, label);
}

function announce(notice: NewJobNotice) {
  if (!win?.isFocused()) win?.flashFrame(true);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `New order #${notice.token}`, body: notice.summary, silent: true });
  n.on('click', () => {
    showWindow();
    win?.webContents.send(IPC.openJob, notice.jobId);
  });
  n.show();
}

/** Only our own window (at our own URL) may use the bridge. */
function trusted(event: IpcMainInvokeEvent | IpcMainEvent) {
  const url = event.senderFrame?.url ?? '';
  if (event.sender !== win?.webContents || !isAppUrl(url)) throw new Error('IPC from an unknown sender');
}

function registerIpc() {
  ipcMain.handle(IPC.sessionGet, (e, key) => (trusted(e), sessionStore.get(key)));
  ipcMain.handle(IPC.sessionSet, (e, key, value) => (trusted(e), sessionStore.set(key, value)));
  ipcMain.handle(IPC.sessionRemove, (e, key) => (trusted(e), sessionStore.remove(key)));

  ipcMain.handle(IPC.listPrinters, async (e) => {
    trusted(e);
    const [printers, fallback] = await Promise.all([e.sender.getPrintersAsync(), defaultPrinterName()]);
    return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: p.name === fallback }));
  });

  ipcMain.handle(IPC.print, async (e, request: PrintRequest) => {
    trusted(e);
    const known = (await e.sender.getPrintersAsync()).map((p) => p.name);
    return printPdf(request, known);
  });

  ipcMain.handle(IPC.settingsGet, (e) => (trusted(e), getSettings()));
  ipcMain.handle(IPC.settingsSet, (e, patch) => (trusted(e), updateSettings(patch)));

  ipcMain.on(IPC.queueChanged, (e, waiting) => {
    trusted(e);
    if (Number.isInteger(waiting) && waiting >= 0) setWaiting(waiting);
  });
  ipcMain.on(IPC.newJob, (e, notice: NewJobNotice) => {
    trusted(e);
    if (typeof notice?.jobId !== 'string' || typeof notice.token !== 'string') return;
    announce({ jobId: notice.jobId, token: notice.token.slice(0, 10), summary: String(notice.summary ?? '').slice(0, 200) });
  });
}

app.on('before-quit', () => {
  quitting = true;
});

// macOS: clicking the dock icon brings the window back.
app.on('activate', showWindow);

// The app lives in the tray; the window closing never quits it.
app.on('window-all-closed', () => {});
