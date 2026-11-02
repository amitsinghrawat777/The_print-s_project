import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PrintsBridge } from '../ipc';

// A narrow, typed bridge. The renderer gets these functions and nothing else:
// no ipcRenderer, no Node, no file system.
const bridge: PrintsBridge = {
  session: {
    get: (key) => ipcRenderer.invoke(IPC.sessionGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.sessionSet, key, value),
    remove: (key) => ipcRenderer.invoke(IPC.sessionRemove, key),
  },
  listPrinters: () => ipcRenderer.invoke(IPC.listPrinters),
  print: (request) => ipcRenderer.invoke(IPC.print, request),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  queueChanged: (waiting) => ipcRenderer.send(IPC.queueChanged, waiting),
  newJob: (notice) => ipcRenderer.send(IPC.newJob, notice),
  onOpenJob: (callback) => {
    const listener = (_event: unknown, jobId: unknown) => {
      if (typeof jobId === 'string') callback(jobId);
    };
    ipcRenderer.on(IPC.openJob, listener);
    return () => ipcRenderer.removeListener(IPC.openJob, listener);
  },
  platform: process.platform as PrintsBridge['platform'],
};

contextBridge.exposeInMainWorld('prints', bridge);
