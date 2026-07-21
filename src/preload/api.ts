import { ipcRenderer } from "electron";

import type { OutgrooveApi } from "../shared/contracts/api";
import { channels } from "../shared/contracts/channels";

export const api: OutgrooveApi = {
  chooseLibraryFolder: () =>
    ipcRenderer.invoke(channels.chooseLibraryFolder, {}),
  listLibraryRoots: () => ipcRenderer.invoke(channels.listLibraryRoots, {}),
  scanLibrary: (request) => ipcRenderer.invoke(channels.scanLibrary, request),
  cancelScan: (request) => ipcRenderer.invoke(channels.cancelScan, request),
  getLatestScanJob: () => ipcRenderer.invoke(channels.getLatestScanJob, {}),
  listAlbums: () => ipcRenderer.invoke(channels.listAlbums, {}),
  listScanErrors: () => ipcRenderer.invoke(channels.listScanErrors, {}),
  previewAlbumTitleEdit: (request) =>
    ipcRenderer.invoke(channels.previewAlbumTitleEdit, request),
  applyAlbumTitleEdit: (request) =>
    ipcRenderer.invoke(channels.applyAlbumTitleEdit, request),
  chooseSyncTargetAndCreateProfile: (request) =>
    ipcRenderer.invoke(channels.createSyncProfile, request),
  planSync: (request) => ipcRenderer.invoke(channels.planSync, request),
  applySync: (request) => ipcRenderer.invoke(channels.applySync, request),
  onJobProgress: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      value: {
        job: "scan" | "tag-edit" | "sync";
        completed: number;
        total: number;
        detail: string;
      },
    ): void => listener(value);
    ipcRenderer.on(channels.jobProgress, wrapped);
    return () => ipcRenderer.removeListener(channels.jobProgress, wrapped);
  },
  onScanJobUpdated: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ): void => listener(value);
    ipcRenderer.on(channels.scanJobUpdated, wrapped);
    return () => ipcRenderer.removeListener(channels.scanJobUpdated, wrapped);
  },
};
