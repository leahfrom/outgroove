import { createHash } from "node:crypto";
import { normalize, resolve } from "node:path";

import { dialog, type BrowserWindow, type IpcMain } from "electron";

import {
  albumEditApplyRequestSchema,
  albumEditHistoryRequestSchema,
  albumEditPreviewRequestSchema,
  albumEditUndoPreviewRequestSchema,
  databaseRestoreApplyRequestSchema,
  createSavedLibraryFilterRequestSchema,
  deleteSavedLibraryFilterRequestSchema,
  emptyRequestSchema,
  libraryQueryRequestSchema,
  libraryRootRemovalApplyRequestSchema,
  libraryRootRemovalPreviewRequestSchema,
  scanCancelRequestSchema,
  scanRequestSchema,
  syncApplyRequestSchema,
  syncPlanRequestSchema,
  syncProfileRequestSchema,
  trackBatchEditPreviewRequestSchema,
  trackNumberSequencePreviewRequestSchema,
  trackTagEditPreviewRequestSchema,
  updateSavedLibraryFilterRequestSchema,
} from "../../shared/contracts/api";
import { channels } from "../../shared/contracts/channels";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { WorkerLibraryQualityQuery } from "../adapters/database/worker-library-quality-query";
import type { DatabaseBackupService } from "../application/database-backup";
import type { DeviceSync } from "../application/device-sync";
import type { EditAlbumTitle } from "../application/edit-album-title";
import type { EditTrackTags } from "../application/edit-track-tags";
import type { ManageLibraryRoots } from "../application/manage-library-roots";
import { pathComparisonKey } from "../application/scan-library";
import type { ScanJobCoordinator } from "../jobs/scan-job-coordinator";
import { createValidatedHandler } from "./validated-handler";

interface Dependencies {
  database: CatalogDatabase;
  qualityQuery: WorkerLibraryQualityQuery;
  backup: DatabaseBackupService;
  scanJobs: ScanJobCoordinator;
  libraryRoots: ManageLibraryRoots;
  editor: EditAlbumTitle;
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
    channels.createSyncProfile,
    createValidatedHandler(
      syncProfileRequestSchema,
      async ({ name, albumId }) => {
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
              albumId,
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
}

export function channelAllowlistDigest(): string {
  return createHash("sha256")
    .update(Object.values(channels).sort().join("\n"))
    .digest("hex");
}
