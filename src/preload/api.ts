import { ipcRenderer } from "electron";

import type { OutgrooveApi } from "../shared/contracts/api";
import { channels } from "../shared/contracts/channels";

export const api: OutgrooveApi = {
  chooseLibraryFolder: () =>
    ipcRenderer.invoke(channels.chooseLibraryFolder, {}),
  listLibraryRoots: () => ipcRenderer.invoke(channels.listLibraryRoots, {}),
  previewLibraryRootRemoval: (request) =>
    ipcRenderer.invoke(channels.previewLibraryRootRemoval, request),
  applyLibraryRootRemoval: (request) =>
    ipcRenderer.invoke(channels.applyLibraryRootRemoval, request),
  scanLibrary: (request) => ipcRenderer.invoke(channels.scanLibrary, request),
  cancelScan: (request) => ipcRenderer.invoke(channels.cancelScan, request),
  getLatestScanJob: () => ipcRenderer.invoke(channels.getLatestScanJob, {}),
  createDatabaseBackup: () =>
    ipcRenderer.invoke(channels.createDatabaseBackup, {}),
  chooseDatabaseRestore: () =>
    ipcRenderer.invoke(channels.chooseDatabaseRestore, {}),
  applyDatabaseRestore: (request) =>
    ipcRenderer.invoke(channels.applyDatabaseRestore, request),
  queryLibrary: (request) => ipcRenderer.invoke(channels.queryLibrary, request),
  loadAlbumArtwork: (request) =>
    ipcRenderer.invoke(channels.loadAlbumArtwork, request),
  findMusicBrainzAlbumCandidates: (request) =>
    ipcRenderer.invoke(channels.findMusicBrainzAlbumCandidates, request),
  loadMusicBrainzReleaseTracks: (request) =>
    ipcRenderer.invoke(channels.loadMusicBrainzReleaseTracks, request),
  cancelMusicBrainzAlbumCandidates: (request) =>
    ipcRenderer.invoke(channels.cancelMusicBrainzAlbumCandidates, request),
  listSavedLibraryFilters: () =>
    ipcRenderer.invoke(channels.listSavedLibraryFilters, {}),
  createSavedLibraryFilter: (request) =>
    ipcRenderer.invoke(channels.createSavedLibraryFilter, request),
  updateSavedLibraryFilter: (request) =>
    ipcRenderer.invoke(channels.updateSavedLibraryFilter, request),
  deleteSavedLibraryFilter: (request) =>
    ipcRenderer.invoke(channels.deleteSavedLibraryFilter, request),
  previewAlbumTitleEdit: (request) =>
    ipcRenderer.invoke(channels.previewAlbumTitleEdit, request),
  applyAlbumTitleEdit: (request) =>
    ipcRenderer.invoke(channels.applyAlbumTitleEdit, request),
  listAlbumEditHistory: (request) =>
    ipcRenderer.invoke(channels.listAlbumEditHistory, request),
  previewAlbumTitleUndo: (request) =>
    ipcRenderer.invoke(channels.previewAlbumTitleUndo, request),
  applyAlbumTitleUndo: (request) =>
    ipcRenderer.invoke(channels.applyAlbumTitleUndo, request),
  chooseAlbumArtworkEdit: (request) =>
    ipcRenderer.invoke(channels.chooseAlbumArtworkEdit, request),
  previewAlbumArtworkRemoval: (request) =>
    ipcRenderer.invoke(channels.previewAlbumArtworkRemoval, request),
  applyAlbumArtworkEdit: (request) =>
    ipcRenderer.invoke(channels.applyAlbumArtworkEdit, request),
  previewAlbumArtworkUndo: (request) =>
    ipcRenderer.invoke(channels.previewAlbumArtworkUndo, request),
  applyAlbumArtworkUndo: (request) =>
    ipcRenderer.invoke(channels.applyAlbumArtworkUndo, request),
  previewAlbumArtworkExport: (request) =>
    ipcRenderer.invoke(channels.previewAlbumArtworkExport, request),
  exportAlbumArtwork: (request) =>
    ipcRenderer.invoke(channels.exportAlbumArtwork, request),
  previewAlbumFolderArtwork: (request) =>
    ipcRenderer.invoke(channels.previewAlbumFolderArtwork, request),
  applyAlbumFolderArtwork: (request) =>
    ipcRenderer.invoke(channels.applyAlbumFolderArtwork, request),
  previewTrackTagEdit: (request) =>
    ipcRenderer.invoke(channels.previewTrackTagEdit, request),
  applyTrackTagEdit: (request) =>
    ipcRenderer.invoke(channels.applyTrackTagEdit, request),
  previewTrackTagUndo: (request) =>
    ipcRenderer.invoke(channels.previewTrackTagUndo, request),
  applyTrackTagUndo: (request) =>
    ipcRenderer.invoke(channels.applyTrackTagUndo, request),
  previewTrackBatchEdit: (request) =>
    ipcRenderer.invoke(channels.previewTrackBatchEdit, request),
  previewMusicBrainzTrackMapping: (request) =>
    ipcRenderer.invoke(channels.previewMusicBrainzTrackMapping, request),
  applyTrackBatchEdit: (request) =>
    ipcRenderer.invoke(channels.applyTrackBatchEdit, request),
  previewTrackBatchUndo: (request) =>
    ipcRenderer.invoke(channels.previewTrackBatchUndo, request),
  applyTrackBatchUndo: (request) =>
    ipcRenderer.invoke(channels.applyTrackBatchUndo, request),
  previewTrackNumberSequence: (request) =>
    ipcRenderer.invoke(channels.previewTrackNumberSequence, request),
  applyTrackNumberSequence: (request) =>
    ipcRenderer.invoke(channels.applyTrackNumberSequence, request),
  chooseSyncTargetAndCreateProfile: (request) =>
    ipcRenderer.invoke(channels.createSyncProfile, request),
  listSyncProfiles: () => ipcRenderer.invoke(channels.listSyncProfiles, {}),
  updateSyncProfileAlbums: (request) =>
    ipcRenderer.invoke(channels.updateSyncProfileAlbums, request),
  renameSyncProfile: (request) =>
    ipcRenderer.invoke(channels.renameSyncProfile, request),
  chooseSyncProfileTarget: (request) =>
    ipcRenderer.invoke(channels.chooseSyncProfileTarget, request),
  applySyncProfileTarget: (request) =>
    ipcRenderer.invoke(channels.applySyncProfileTarget, request),
  listSyncHistory: (request) =>
    ipcRenderer.invoke(channels.listSyncHistory, request),
  planSync: (request) => ipcRenderer.invoke(channels.planSync, request),
  applySync: (request) => ipcRenderer.invoke(channels.applySync, request),
  cancelSync: (request) => ipcRenderer.invoke(channels.cancelSync, request),
  listSyncRecoveries: () => ipcRenderer.invoke(channels.listSyncRecoveries, {}),
  previewSyncRecovery: (request) =>
    ipcRenderer.invoke(channels.previewSyncRecovery, request),
  applySyncRecovery: (request) =>
    ipcRenderer.invoke(channels.applySyncRecovery, request),
  onJobProgress: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      value: {
        job: "scan" | "tag-edit" | "sync" | "library-quality";
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
