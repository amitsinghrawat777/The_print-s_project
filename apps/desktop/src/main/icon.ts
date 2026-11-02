import { join } from 'node:path';
import { app, nativeImage, nativeTheme, type NativeImage } from 'electron';

/**
 * Brand icons in resources/, shipped next to the app like SumatraPDF. Each comes
 * in a light and a dark version that follow the Windows/macOS theme:
 * - icon-*.png: the P on a tile, for the window and taskbar
 * - tray-*.png: the bare P, for the tray / menu bar
 */
type Kind = 'icon' | 'tray';
const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
const cache = new Map<string, NativeImage>();

function load(kind: Kind): NativeImage {
  const file = `${kind}-${nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? 'dark' : 'light'}.png`;
  let img = cache.get(file);
  if (!img) {
    img = nativeImage.createFromPath(join(resources, file));
    cache.set(file, img);
  }
  return img;
}

/** The window/taskbar icon for the current theme. */
export function appIcon(size: number): NativeImage {
  return load('icon').resize({ width: size, height: size, quality: 'best' });
}

/**
 * The tray icon for the current theme. With `badge`, a red dot is painted in
 * the top-right corner to show that orders are waiting.
 */
export function trayIcon(size: number, badge = false): NativeImage {
  const icon = load('tray').resize({ width: size, height: size, quality: 'best' });
  if (!badge) return icon;
  const px = icon.toBitmap(); // BGRA
  paintDot(px, size, size * 0.8, size * 0.2, size * 0.2);
  return nativeImage.createFromBitmap(px, { width: size, height: size });
}

/** Just the red dot, for the Windows taskbar overlay that sits on top of the app icon. */
export function badgeDot(size: number): NativeImage {
  const px = Buffer.alloc(size * size * 4);
  paintDot(px, size, size / 2, size / 2, size * 0.42);
  return nativeImage.createFromBitmap(px, { width: size, height: size });
}

function paintDot(px: Buffer, size: number, cx: number, cy: number, r: number) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
      const i = (y * size + x) * 4;
      px[i] = 0x44; // #ef4444 in BGRA
      px[i + 1] = 0x44;
      px[i + 2] = 0xef;
      px[i + 3] = 0xff;
    }
  }
}
