import { createHash } from "node:crypto";
import { normalize, resolve } from "node:path";

import { dialog, type BrowserWindow, type IpcMain } from "electron";

import {
  albumEditApplyRequestSchema,
  albumArtworkRequestSchema,
  albumArtworkEditPreviewRequestSchema,
  albumArtworkExportPreviewRequestSchema,
  albumFolderArtworkPreviewRequestSchema,
  albumEditHistoryRequestSchema,
  albumEditPreviewRequestSchema,
  albumEditUndoPreviewRequestSchema,
  albumIdentificationRequestSchema,
  coverArtArchiveRequestSchema,
  databaseRestoreApplyRequestSchema,
  createSavedLibraryFilterRequestSchema,
  deleteSavedLibraryFilterRequestSchema,
  emptyRequestSchema,
  libraryQueryRequestSchema,
  libraryRootRemovalApplyRequestSchema,
  libraryRootRemovalPreviewRequestSchema,
  musicBrainzReleaseLookupRequestSchema,
  musicBrainzTrackMappingPreviewRequestSchema,
  renameSyncProfileRequestSchema,
  scanCancelRequestSchema,
  scanRequestSchema,
  syncApplyRequestSchema,
  syncCancelRequestSchema,
  syncHistoryRequestSchema,
  syncProfileTargetApplyRequestSchema,
  syncProfileTargetPreviewRequestSchema,
  syncRecoveryApplyRequestSchema,
  syncRecoveryPreviewRequestSchema,
  syncPlanRequestSchema,
  syncProfileRequestSchema,
  trackBatchEditPreviewRequestSchema,
  trackNumberSequencePreviewRequestSchema,
  trackTagEditPreviewRequestSchema,
  updateSyncProfileAlbumsRequestSchema,
  updateSavedLibraryFilterRequestSchema,
} from "../../shared/contracts/api";
import { channels } from "../../shared/contracts/channels";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { WorkerLibraryQualityQuery } from "../adapters/database/worker-library-quality-query";
import type { DatabaseBackupService } from "../application/database-backup";
import type { DeviceSync } from "../application/device-sync";
import type { EditAlbumTitle } from "../application/edit-album-title";
import type { EditAlbumArtwork } from "../application/edit-album-artwork";
import type { ExportAlbumArtwork } from "../application/export-album-artwork";
import type { CreateAlbumFolderArtwork } from "../application/create-album-folder-artwork";
import type { EditTrackTags } from "../application/edit-track-tags";
import type { ManageLibraryRoots } from "../application/manage-library-roots";
import type { LoadAlbumArtwork } from "../application/load-album-artwork";
import type { FindAlbumCandidates } from "../application/find-album-candidates";
import type { FindReleaseArtwork } from "../application/find-release-artwork";
import { pathComparisonKey } from "../application/scan-library";
import type { ScanJobCoordinator } from "../jobs/scan-job-coordinator";
import { createValidatedHandler } from "./validated-handler";

interface Dependencies {
  database: CatalogDatabase;
  qualityQuery: WorkerLibraryQualityQuery;
  backup: DatabaseBackupService;
  scanJobs: ScanJobCoordinator;
  libraryRoots: ManageLibraryRoots;
  artwork: LoadAlbumArtwork;
  albumCandidates: FindAlbumCandidates;
  releaseArtwork: FindReleaseArtwork;
  editor: EditAlbumTitle;
  artworkEditor: EditAlbumArtwork;
  artworkExporter: ExportAlbumArtwork;
  folderArtworkCreator: CreateAlbumFolderArtwork;
  trackEditor: EditTrackTags;
  sync: DeviceSync;
  window: BrowserWindow;
  restartApp: () => void;
}

export function registerIpc(
  ipcMain: IpcMain,
  dependencies: Dependencies,
): void {
  const progress =
    (job: "scan" | "tag-edit" | "sync" | "library-quality") =>
    (completed: number, total: number, detail: string): void => {
      if (!dependencies.window.isDestroyed())
        dependencies.window.webContents.send(channels.jobProgress, {
          job,
          completed,
          total,
          detail,
        });
    };
  dependencies.scanJobs.onUpdated((job) => {
    if (!dependencies.window.isDestroyed())
      dependencies.window.webContents.send(channels.scanJobUpdated, job);
  });
  ipcMain.handle(
    channels.chooseLibraryFolder,
    createValidatedHandler(emptyRequestSchema, async () => {
      const selected = await dialog.showOpenDialog(dependencies.window, {
        title: "Choose a music library fixture folder",
        properties: ["openDirectory"],
      });
      const path = selected.filePaths[0];
      return selected.canceled || !path
        ? null
        : dependencies.database.addLibraryRoot(
            normalize(resolve(path)),
            pathComparisonKey(path),
          );
    }),
  );
  ipcMain.handle(
    channels.listLibraryRoots,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.database.listLibraryRoots(),
    ),
  );
  ipcMain.handle(
    channels.previewLibraryRootRemoval,
    createValidatedHandler(
      libraryRootRemovalPreviewRequestSchema,
      ({ rootId }) => dependencies.libraryRoots.previewRemoval(rootId),
    ),
  );
  ipcMain.handle(
    channels.applyLibraryRootRemoval,
    createValidatedHandler(
      libraryRootRemovalApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.libraryRoots.applyRemoval(operationId, confirmationToken),
    ),
  );
  ipcMain.handle(
    channels.scanLibrary,
    createValidatedHandler(scanRequestSchema, ({ rootId }) =>
      dependencies.scanJobs.start(rootId),
    ),
  );
  ipcMain.handle(
    channels.cancelScan,
    createValidatedHandler(scanCancelRequestSchema, ({ jobId }) =>
      dependencies.scanJobs.cancel(jobId),
    ),
  );
  ipcMain.handle(
    channels.getLatestScanJob,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.scanJobs.latest(),
    ),
  );
  ipcMain.handle(
    channels.createDatabaseBackup,
    createValidatedHandler(emptyRequestSchema, async () => {
      const date = new Date().toISOString().slice(0, 10);
      const selected = await dialog.showSaveDialog(dependencies.window, {
        title: "Export Outgroove database backup",
        defaultPath: `outgroove-backup-${date}.sqlite3`,
        filters: [{ name: "SQLite database", extensions: ["sqlite3"] }],
      });
      return selected.canceled || !selected.filePath
        ? null
        : dependencies.backup.exportTo(selected.filePath);
    }),
  );
  ipcMain.handle(
    channels.chooseDatabaseRestore,
    createValidatedHandler(emptyRequestSchema, async () => {
      const selected = await dialog.showOpenDialog(dependencies.window, {
        title: "Choose an Outgroove database backup",
        properties: ["openFile"],
        filters: [{ name: "SQLite database", extensions: ["sqlite3"] }],
      });
      const path = selected.filePaths[0];
      return selected.canceled || !path
        ? null
        : dependencies.backup.previewRestore(path);
    }),
  );
  ipcMain.handle(
    channels.applyDatabaseRestore,
    createValidatedHandler(
      databaseRestoreApplyRequestSchema,
      async ({ operationId, confirmationToken }) => {
        try {
          const result = await dependencies.backup.applyRestore(
            operationId,
            confirmationToken,
          );
          setTimeout(dependencies.restartApp, 250);
          return result;
        } catch (error) {
          if (!dependencies.database.connection.open)
            setTimeout(dependencies.restartApp, 250);
          throw error;
        }
      },
    ),
  );
  ipcMain.handle(
    channels.queryLibrary,
    createValidatedHandler(libraryQueryRequestSchema, async (request) => {
      if (request.view === "data-quality")
        return dependencies.qualityQuery.query(
          {
            query: request.query,
            offset: request.offset,
            limit: request.limit,
            qualityFilter: request.qualityFilter ?? "all",
          },
          progress("library-quality"),
        );
      await dependencies.qualityQuery.cancel();
      return dependencies.database.queryLibrary({
        query: request.query,
        view:
          request.view === "scan-errors"
            ? "scan-errors"
            : request.view === "artists"
              ? "artists"
              : request.view === "genres"
                ? "genres"
                : request.view === "formats"
                  ? "formats"
                  : request.view === "folders"
                    ? "folders"
                    : request.view === "tracks"
                      ? "tracks"
                      : "albums",
        offset: request.offset,
        limit: request.limit,
        ...(request.albumArtist ? { albumArtist: request.albumArtist } : {}),
        ...(request.albumId ? { albumId: request.albumId } : {}),
        ...(request.format ? { format: request.format } : {}),
        ...(request.folderId ? { folderId: request.folderId } : {}),
        ...(request.genre ? { genre: request.genre } : {}),
        ...(request.missingGenre ? { missingGenre: request.missingGenre } : {}),
      });
    }),
  );
  ipcMain.handle(
    channels.loadAlbumArtwork,
    createValidatedHandler(albumArtworkRequestSchema, ({ albumIds }) =>
      dependencies.artwork.load(albumIds),
    ),
  );
  ipcMain.handle(
    channels.findMusicBrainzAlbumCandidates,
    createValidatedHandler(albumIdentificationRequestSchema, ({ albumId }) =>
      dependencies.albumCandidates.search(albumId),
    ),
  );
  ipcMain.handle(
    channels.loadMusicBrainzReleaseTracks,
    createValidatedHandler(
      musicBrainzReleaseLookupRequestSchema,
      ({ albumId, releaseId }) =>
        dependencies.albumCandidates.release(albumId, releaseId),
    ),
  );
  ipcMain.handle(
    channels.loadCoverArtArchiveArtwork,
    createValidatedHandler(
      coverArtArchiveRequestSchema,
      ({ albumId, releaseId }) =>
        dependencies.releaseArtwork.load(albumId, releaseId),
    ),
  );
  ipcMain.handle(
    channels.cancelMusicBrainzAlbumCandidates,
    createValidatedHandler(albumIdentificationRequestSchema, ({ albumId }) =>
      dependencies.albumCandidates.cancel(albumId),
    ),
  );
  ipcMain.handle(
    channels.cancelCoverArtArchiveArtwork,
    createValidatedHandler(albumIdentificationRequestSchema, ({ albumId }) =>
      dependencies.releaseArtwork.cancel(albumId),
    ),
  );
  ipcMain.handle(
    channels.listSavedLibraryFilters,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.database.listSavedLibraryFilters(),
    ),
  );
  ipcMain.handle(
    channels.createSavedLibraryFilter,
    createValidatedHandler(
      createSavedLibraryFilterRequestSchema,
      ({ name, definition }) =>
        dependencies.database.createSavedLibraryFilter(name, definition),
    ),
  );
  ipcMain.handle(
    channels.updateSavedLibraryFilter,
    createValidatedHandler(
      updateSavedLibraryFilterRequestSchema,
      ({ id, name, definition }) =>
        dependencies.database.updateSavedLibraryFilter(id, name, definition),
    ),
  );
  ipcMain.handle(
    channels.deleteSavedLibraryFilter,
    createValidatedHandler(deleteSavedLibraryFilterRequestSchema, ({ id }) =>
      dependencies.database.deleteSavedLibraryFilter(id),
    ),
  );
  ipcMain.handle(
    channels.previewAlbumTitleEdit,
    createValidatedHandler(
      albumEditPreviewRequestSchema,
      ({ albumId, proposedTitle }) =>
        dependencies.editor.preview(albumId, proposedTitle),
    ),
  );
  ipcMain.handle(
    channels.applyAlbumTitleEdit,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.editor.apply(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.listAlbumEditHistory,
    createValidatedHandler(albumEditHistoryRequestSchema, ({ albumId }) =>
      dependencies.editor.history(albumId),
    ),
  );
  ipcMain.handle(
    channels.previewAlbumTitleUndo,
    createValidatedHandler(
      albumEditUndoPreviewRequestSchema,
      ({ operationId }) => dependencies.editor.previewUndo(operationId),
    ),
  );
  ipcMain.handle(
    channels.applyAlbumTitleUndo,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.editor.applyUndo(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.chooseAlbumArtworkEdit,
    createValidatedHandler(
      albumArtworkEditPreviewRequestSchema,
      async ({ albumId }) => {
        const selected = await dialog.showOpenDialog(dependencies.window, {
          title: "Choose album artwork",
          properties: ["openFile"],
          filters: [
            { name: "JPEG or PNG artwork", extensions: ["jpg", "jpeg", "png"] },
          ],
        });
        const path = selected.filePaths[0];
        return selected.canceled || !path
          ? null
          : dependencies.artworkEditor.preview(
              albumId,
              normalize(resolve(path)),
            );
      },
    ),
  );
  ipcMain.handle(
    channels.applyAlbumArtworkEdit,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.artworkEditor.apply(
          operationId,
          confirmationToken,
          "album-artwork-edit",
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.previewAlbumArtworkRemoval,
    createValidatedHandler(
      albumArtworkEditPreviewRequestSchema,
      ({ albumId }) => dependencies.artworkEditor.previewRemoval(albumId),
    ),
  );
  ipcMain.handle(
    channels.previewAlbumArtworkUndo,
    createValidatedHandler(
      albumEditUndoPreviewRequestSchema,
      ({ operationId }) => dependencies.artworkEditor.previewUndo(operationId),
    ),
  );
  ipcMain.handle(
    channels.applyAlbumArtworkUndo,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.artworkEditor.apply(
          operationId,
          confirmationToken,
          "album-artwork-undo",
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.previewAlbumArtworkExport,
    createValidatedHandler(
      albumArtworkExportPreviewRequestSchema,
      ({ albumId }) => dependencies.artworkExporter.preview(albumId),
    ),
  );
  ipcMain.handle(
    channels.exportAlbumArtwork,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      async ({ operationId, confirmationToken }) => {
        const details = dependencies.artworkExporter.exportDetails(
          operationId,
          confirmationToken,
        );
        const selected = await dialog.showSaveDialog(dependencies.window, {
          title: "Export local album artwork",
          defaultPath: details.suggestedFileName,
          filters: [
            details.mimeType === "image/jpeg"
              ? { name: "JPEG artwork", extensions: ["jpg", "jpeg"] }
              : { name: "PNG artwork", extensions: ["png"] },
          ],
        });
        return selected.canceled || !selected.filePath
          ? null
          : dependencies.artworkExporter.exportTo(
              operationId,
              confirmationToken,
              normalize(resolve(selected.filePath)),
            );
      },
    ),
  );
  ipcMain.handle(
    channels.previewAlbumFolderArtwork,
    createValidatedHandler(
      albumFolderArtworkPreviewRequestSchema,
      ({ albumId }) => dependencies.folderArtworkCreator.preview(albumId),
    ),
  );
  ipcMain.handle(
    channels.applyAlbumFolderArtwork,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.folderArtworkCreator.apply(operationId, confirmationToken),
    ),
  );
  ipcMain.handle(
    channels.previewTrackTagEdit,
    createValidatedHandler(
      trackTagEditPreviewRequestSchema,
      ({ fileId, changes }) =>
        dependencies.trackEditor.preview(fileId, changes),
    ),
  );
  ipcMain.handle(
    channels.applyTrackTagEdit,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.trackEditor.apply(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.previewTrackTagUndo,
    createValidatedHandler(
      albumEditUndoPreviewRequestSchema,
      ({ operationId }) => dependencies.trackEditor.previewUndo(operationId),
    ),
  );
  ipcMain.handle(
    channels.applyTrackTagUndo,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.trackEditor.applyUndo(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.previewTrackBatchEdit,
    createValidatedHandler(
      trackBatchEditPreviewRequestSchema,
      ({ fileIds, changes }) =>
        dependencies.trackEditor.previewBatch(fileIds, changes),
    ),
  );
  ipcMain.handle(
    channels.previewMusicBrainzTrackMapping,
    createValidatedHandler(
      musicBrainzTrackMappingPreviewRequestSchema,
      ({ albumId, releaseId, edits }) =>
        dependencies.trackEditor.previewMusicBrainzMapping(
          albumId,
          releaseId,
          edits,
        ),
    ),
  );
  ipcMain.handle(
    channels.applyTrackBatchEdit,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.trackEditor.applyBatch(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.previewTrackBatchUndo,
    createValidatedHandler(
      albumEditUndoPreviewRequestSchema,
      ({ operationId }) =>
        dependencies.trackEditor.previewBatchUndo(operationId),
    ),
  );
  ipcMain.handle(
    channels.applyTrackBatchUndo,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.trackEditor.applyBatchUndo(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.previewTrackNumberSequence,
    createValidatedHandler(
      trackNumberSequencePreviewRequestSchema,
      ({ fileIds, startNumber, discNumber }) =>
        dependencies.trackEditor.previewTrackNumberSequence(
          fileIds,
          startNumber,
          discNumber,
        ),
    ),
  );
  ipcMain.handle(
    channels.applyTrackNumberSequence,
    createValidatedHandler(
      albumEditApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.trackEditor.applyTrackNumberSequence(
          operationId,
          confirmationToken,
          progress("tag-edit"),
        ),
    ),
  );
  ipcMain.handle(
    channels.listSyncProfiles,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.database.listSyncProfiles(),
    ),
  );
  ipcMain.handle(
    channels.updateSyncProfileAlbums,
    createValidatedHandler(
      updateSyncProfileAlbumsRequestSchema,
      ({ id, albumIds }) => dependencies.sync.updateProfileAlbums(id, albumIds),
    ),
  );
  ipcMain.handle(
    channels.renameSyncProfile,
    createValidatedHandler(renameSyncProfileRequestSchema, ({ id, name }) =>
      dependencies.database.renameSyncProfile(id, name),
    ),
  );
  ipcMain.handle(
    channels.chooseSyncProfileTarget,
    createValidatedHandler(
      syncProfileTargetPreviewRequestSchema,
      async ({ profileId }) => {
        const selected = await dialog.showOpenDialog(dependencies.window, {
          title: "Choose a new folder-backed DAP target",
          properties: ["openDirectory", "createDirectory"],
        });
        const targetPath = selected.filePaths[0];
        return selected.canceled || !targetPath
          ? null
          : dependencies.sync.previewProfileTarget(
              profileId,
              normalize(resolve(targetPath)),
            );
      },
    ),
  );
  ipcMain.handle(
    channels.applySyncProfileTarget,
    createValidatedHandler(
      syncProfileTargetApplyRequestSchema,
      ({ operationId, confirmationToken }) =>
        dependencies.sync.applyProfileTarget(operationId, confirmationToken),
    ),
  );
  ipcMain.handle(
    channels.listSyncHistory,
    createValidatedHandler(syncHistoryRequestSchema, ({ profileId }) =>
      dependencies.database.listSyncHistory(profileId),
    ),
  );
  ipcMain.handle(
    channels.createSyncProfile,
    createValidatedHandler(
      syncProfileRequestSchema,
      async ({ name, albumIds }) => {
        const selected = await dialog.showOpenDialog(dependencies.window, {
          title: "Choose a folder-backed DAP target",
          properties: ["openDirectory", "createDirectory"],
        });
        const targetPath = selected.filePaths[0];
        return selected.canceled || !targetPath
          ? null
          : dependencies.database.createSyncProfile(
              name,
              normalize(resolve(targetPath)),
              albumIds,
            );
      },
    ),
  );
  ipcMain.handle(
    channels.planSync,
    createValidatedHandler(syncPlanRequestSchema, ({ profileId }) =>
      dependencies.sync.plan(profileId),
    ),
  );
  ipcMain.handle(
    channels.applySync,
    createValidatedHandler(
      syncApplyRequestSchema,
      ({ planId, confirmationToken }) =>
        dependencies.sync.apply(planId, confirmationToken, progress("sync")),
    ),
  );
  ipcMain.handle(
    channels.cancelSync,
    createValidatedHandler(syncCancelRequestSchema, ({ planId }) =>
      dependencies.sync.cancel(planId),
    ),
  );
  ipcMain.handle(
    channels.listSyncRecoveries,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.sync.listRecoverySummaries(),
    ),
  );
  ipcMain.handle(
    channels.previewSyncRecovery,
    createValidatedHandler(syncRecoveryPreviewRequestSchema, ({ runId }) =>
      dependencies.sync.previewRecovery(runId),
    ),
  );
  ipcMain.handle(
    channels.applySyncRecovery,
    createValidatedHandler(
      syncRecoveryApplyRequestSchema,
      ({ runId, confirmationToken }) =>
        dependencies.sync.recover(runId, confirmationToken),
    ),
  );
}

export function channelAllowlistDigest(): string {
  return createHash("sha256")
    .update(Object.values(channels).sort().join("\n"))
    .digest("hex");
}
