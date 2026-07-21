import { createHash } from "node:crypto";
import { normalize, resolve } from "node:path";

import { dialog, type BrowserWindow, type IpcMain } from "electron";

import {
  albumEditApplyRequestSchema,
  albumEditPreviewRequestSchema,
  emptyRequestSchema,
  scanCancelRequestSchema,
  scanRequestSchema,
  syncApplyRequestSchema,
  syncPlanRequestSchema,
  syncProfileRequestSchema,
} from "../../shared/contracts/api";
import { channels } from "../../shared/contracts/channels";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { DeviceSync } from "../application/device-sync";
import type { EditAlbumTitle } from "../application/edit-album-title";
import { pathComparisonKey } from "../application/scan-library";
import type { ScanJobCoordinator } from "../jobs/scan-job-coordinator";
import { createValidatedHandler } from "./validated-handler";

interface Dependencies {
  database: CatalogDatabase;
  scanJobs: ScanJobCoordinator;
  editor: EditAlbumTitle;
  sync: DeviceSync;
  window: BrowserWindow;
}

export function registerIpc(
  ipcMain: IpcMain,
  dependencies: Dependencies,
): void {
  const progress =
    (job: "scan" | "tag-edit" | "sync") =>
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
    channels.listAlbums,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.database.listAlbums(),
    ),
  );
  ipcMain.handle(
    channels.listScanErrors,
    createValidatedHandler(emptyRequestSchema, () =>
      dependencies.database.listScanErrors(),
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
