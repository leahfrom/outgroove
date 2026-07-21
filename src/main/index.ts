import { join } from "node:path";

import { app, BrowserWindow, ipcMain, session } from "electron";

import { CatalogDatabase } from "./adapters/database/catalog-database";
import { MusicMetadataReader } from "./adapters/metadata/metadata-reader";
import { SafeMetadataWriter } from "./adapters/metadata/metadata-writer";
import { DeviceSync } from "./application/device-sync";
import { DatabaseBackupService } from "./application/database-backup";
import { EditAlbumTitle } from "./application/edit-album-title";
import { ScanLibrary } from "./application/scan-library";
import { registerIpc } from "./ipc/register-ipc";
import { WorkerMetadataJobRunner } from "./jobs/metadata-runner";
import { ScanJobCoordinator } from "./jobs/scan-job-coordinator";
import { contentSecurityPolicy } from "./windows/security-policy";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const smokeTest =
  process.argv.includes("--smoke-test") ||
  process.env.OUTGROOVE_SMOKE_TEST === "1";
if (smokeTest && process.env.OUTGROOVE_SMOKE_USER_DATA)
  app.setPath("userData", process.env.OUTGROOVE_SMOKE_USER_DATA);

let database: CatalogDatabase | undefined;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());

  const databasePath = join(app.getPath("userData"), "outgroove.sqlite3");
  database = new CatalogDatabase(databasePath);
  const reader = new MusicMetadataReader();
  const metadataRunner = new WorkerMetadataJobRunner();
  const scanner = new ScanLibrary(database, metadataRunner);
  const backup = new DatabaseBackupService(database, databasePath);
  registerIpc(ipcMain, {
    database,
    backup,
    scanJobs: new ScanJobCoordinator(database, scanner),
    editor: new EditAlbumTitle(database, new SafeMetadataWriter(reader)),
    sync: new DeviceSync(database),
    window,
    restartApp: () => {
      app.relaunch();
      app.exit(0);
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    await window.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  if (smokeTest) {
    const fixture = join(
      app.getAppPath(),
      "fixtures",
      "audio",
      "album",
      "01-first.mp3",
    );
    const results = await metadataRunner.readAll([fixture], () => undefined);
    if (results[0]?.ok !== true)
      throw new Error("Packaged metadata worker could not parse its fixture.");
    const backupPath = join(app.getPath("userData"), "smoke-backup.sqlite3");
    await backup.exportTo(backupPath);
    const verifiedBackup = new CatalogDatabase(backupPath);
    if (
      verifiedBackup.connection.pragma("integrity_check", { simple: true }) !==
      "ok"
    )
      throw new Error("Packaged database backup failed verification.");
    verifiedBackup.close();
    console.log("OUTGROOVE_SMOKE_OK");
    app.exit(0);
  }
}

void app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            contentSecurityPolicy(Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL)),
          ],
        },
      }),
    );
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((error: unknown) => {
    console.error("Outgroove failed to initialize.", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => database?.close());
