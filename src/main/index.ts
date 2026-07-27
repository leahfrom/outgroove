import { join } from "node:path";

import { app, BrowserWindow, ipcMain, session } from "electron";

import { CatalogDatabase } from "./adapters/database/catalog-database";
import { WorkerScanCatalog } from "./adapters/database/worker-scan-catalog";
import { WorkerLibraryQualityQuery } from "./adapters/database/worker-library-quality-query";
import { WorkerLibraryFileSystem } from "./adapters/filesystem/library-filesystem";
import { MusicMetadataReader } from "./adapters/metadata/metadata-reader";
import { ElectronArtworkThumbnailEncoder } from "./adapters/artwork/artwork-thumbnail";
import { SafeMetadataWriter } from "./adapters/metadata/metadata-writer";
import { DeviceSync } from "./application/device-sync";
import { DatabaseBackupService } from "./application/database-backup";
import { EditAlbumTitle } from "./application/edit-album-title";
import { EditAlbumArtwork } from "./application/edit-album-artwork";
import { EditTrackTags } from "./application/edit-track-tags";
import { ManageLibraryRoots } from "./application/manage-library-roots";
import { LoadAlbumArtwork } from "./application/load-album-artwork";
import { pathComparisonKey, ScanLibrary } from "./application/scan-library";
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
let scanCatalog: WorkerScanCatalog | undefined;
let qualityQuery: WorkerLibraryQualityQuery | undefined;

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
  scanCatalog = new WorkerScanCatalog(databasePath);
  qualityQuery = new WorkerLibraryQualityQuery(databasePath);
  const reader = new MusicMetadataReader();
  const writer = new SafeMetadataWriter(reader);
  const artwork = new LoadAlbumArtwork(
    database,
    new ElectronArtworkThumbnailEncoder(),
  );
  const metadataRunner = new WorkerMetadataJobRunner();
  const scanner = new ScanLibrary(
    database,
    metadataRunner,
    new WorkerLibraryFileSystem(),
    scanCatalog,
  );
  const backup = new DatabaseBackupService(database, databasePath);
  registerIpc(ipcMain, {
    database,
    qualityQuery,
    backup,
    scanJobs: new ScanJobCoordinator(database, scanner),
    libraryRoots: new ManageLibraryRoots(database),
    artwork,
    editor: new EditAlbumTitle(database, writer),
    artworkEditor: new EditAlbumArtwork(
      database,
      writer,
      new ElectronArtworkThumbnailEncoder(),
    ),
    trackEditor: new EditTrackTags(database, writer),
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
    const fixtureAlbum = join(app.getAppPath(), "fixtures", "audio", "album");
    const smokeRoot = database.addLibraryRoot(
      fixtureAlbum,
      pathComparisonKey(fixtureAlbum),
    );
    const smokeResult = await scanner.execute(smokeRoot.id);
    if (smokeResult.parsed !== 2 || smokeResult.errors !== 1)
      throw new Error(
        "Packaged discovery, metadata, and SQLite workers could not scan their fixtures.",
      );
    const qualityPage = await qualityQuery.query({
      query: "",
      offset: 0,
      limit: 20,
      qualityFilter: "all",
    });
    if (qualityPage.offset !== 0 || qualityPage.limit !== 20)
      throw new Error(
        "Packaged library data-quality worker returned an invalid page.",
      );
    const preservationRoot = database.addLibraryRoot(
      join(app.getAppPath(), "fixtures", "audio", "preservation"),
      pathComparisonKey(
        join(app.getAppPath(), "fixtures", "audio", "preservation"),
      ),
    );
    const preservationResult = await scanner.execute(preservationRoot.id);
    if (preservationResult.parsed !== 2 || preservationResult.errors !== 0)
      throw new Error("Packaged artwork fixtures could not be scanned.");
    const preservationAlbum = database.queryLibrary({
      query: "Preservation Album",
      view: "albums",
      offset: 0,
      limit: 1,
    }).albums[0];
    if (!preservationAlbum)
      throw new Error("Packaged artwork fixture album was not cataloged.");
    const thumbnail = (await artwork.load([preservationAlbum.id]))[0];
    if (
      thumbnail?.status !== "available" ||
      !thumbnail.dataUrl?.startsWith("data:image/png;base64,")
    )
      throw new Error(
        "Packaged local artwork extraction and thumbnail encoding failed.",
      );
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
    await scanCatalog.close();
    await qualityQuery.close();
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
app.on("before-quit", () => {
  void scanCatalog?.close();
  void qualityQuery?.close();
  database?.close();
});
