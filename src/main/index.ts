import { join } from "node:path";

import { app, BrowserWindow, ipcMain, session } from "electron";

import { CatalogDatabase } from "./adapters/database/catalog-database";
import { MusicMetadataReader } from "./adapters/metadata/metadata-reader";
import { SafeMetadataWriter } from "./adapters/metadata/metadata-writer";
import { DeviceSync } from "./application/device-sync";
import { EditAlbumTitle } from "./application/edit-album-title";
import { ScanLibrary } from "./application/scan-library";
import { registerIpc } from "./ipc/register-ipc";
import { WorkerMetadataJobRunner } from "./jobs/metadata-runner";
import { ScanJobCoordinator } from "./jobs/scan-job-coordinator";
import { contentSecurityPolicy } from "./windows/security-policy";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

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

  database = new CatalogDatabase(
    join(app.getPath("userData"), "outgroove.sqlite3"),
  );
  const reader = new MusicMetadataReader();
  const metadataRunner = new WorkerMetadataJobRunner();
  const scanner = new ScanLibrary(database, metadataRunner);
  registerIpc(ipcMain, {
    database,
    scanJobs: new ScanJobCoordinator(database, scanner),
    editor: new EditAlbumTitle(database, new SafeMetadataWriter(reader)),
    sync: new DeviceSync(database),
    window,
  });

  const smokeTest =
    process.argv.includes("--smoke-test") ||
    process.env.OUTGROOVE_SMOKE_TEST === "1";
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
