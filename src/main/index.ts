import { join } from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  powerMonitor,
  session,
  shell,
} from "electron";

import { CatalogDatabase } from "./adapters/database/catalog-database";
import { WorkerScanCatalog } from "./adapters/database/worker-scan-catalog";
import { WorkerLibraryQualityQuery } from "./adapters/database/worker-library-quality-query";
import { WorkerLibraryFileSystem } from "./adapters/filesystem/library-filesystem";
import { MusicMetadataReader } from "./adapters/metadata/metadata-reader";
import { MusicBrainzClient } from "./adapters/providers/musicbrainz-client";
import { AcoustIdClient } from "./adapters/providers/acoustid-client";
import { FpcalcFingerprinter } from "./adapters/fingerprint/fpcalc-fingerprinter";
import { resolveBundledFpcalcPath } from "./adapters/fingerprint/fpcalc-path";
import { CoverArtArchiveClient } from "./adapters/providers/cover-art-archive-client";
import { ElectronArtworkThumbnailEncoder } from "./adapters/artwork/artwork-thumbnail";
import { SafeMetadataWriter } from "./adapters/metadata/metadata-writer";
import { createElectronRadarNotifier } from "./adapters/notifications/electron-radar-notifier";
import { DeviceSync } from "./application/device-sync";
import { DatabaseBackupService } from "./application/database-backup";
import { EditAlbumTitle } from "./application/edit-album-title";
import { EditAlbumArtwork } from "./application/edit-album-artwork";
import { CreateAlbumFolderArtwork } from "./application/create-album-folder-artwork";
import { ExportAlbumArtwork } from "./application/export-album-artwork";
import { EditTrackTags } from "./application/edit-track-tags";
import { ManageLibraryRoots } from "./application/manage-library-roots";
import { LoadAlbumArtwork } from "./application/load-album-artwork";
import { FindAlbumCandidates } from "./application/find-album-candidates";
import { IdentifyTrackByFingerprint } from "./application/identify-track-by-fingerprint";
import { FindReleaseArtwork } from "./application/find-release-artwork";
import { ManageFavoriteArtists } from "./application/manage-favorite-artists";
import { RefreshRadar } from "./application/refresh-radar";
import { RadarBackgroundRefresh } from "./application/radar-background-refresh";
import { OpenRadarItem } from "./application/open-radar-item";
import { pathComparisonKey, ScanLibrary } from "./application/scan-library";
import { registerIpc } from "./ipc/register-ipc";
import {
  loadPackagedInspectionSession,
  writePackagedInspectionReadyMarker,
} from "./inspection/packaged-inspection";
import { WorkerMetadataJobRunner } from "./jobs/metadata-runner";
import { ScanJobCoordinator } from "./jobs/scan-job-coordinator";
import { contentSecurityPolicy } from "./windows/security-policy";
import { channels } from "../shared/contracts/channels";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const OUTGROOVE_ACOUSTID_API_KEY: string | null;
declare const OUTGROOVE_INSPECTION_BUILD: boolean;

const smokeTest =
  process.argv.includes("--smoke-test") ||
  process.env.OUTGROOVE_SMOKE_TEST === "1";
const packagedInspection = loadPackagedInspectionSession(
  OUTGROOVE_INSPECTION_BUILD,
  process.argv,
);
if (packagedInspection && smokeTest)
  throw new Error(
    "Packaged inspection and automated smoke modes cannot run together.",
  );
if (packagedInspection) {
  app.setName("Outgroove Inspection");
  app.setPath("userData", packagedInspection.userData);
}
if (smokeTest && process.env.OUTGROOVE_SMOKE_USER_DATA)
  app.setPath("userData", process.env.OUTGROOVE_SMOKE_USER_DATA);
if (process.platform === "win32")
  app.setAppUserModelId(
    packagedInspection
      ? "com.squirrel.Outgroove.Inspection"
      : "com.squirrel.Outgroove.Outgroove",
  );

let database: CatalogDatabase | undefined;
let scanCatalog: WorkerScanCatalog | undefined;
let qualityQuery: WorkerLibraryQualityQuery | undefined;
let radarBackground: RadarBackgroundRefresh | undefined;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    title: packagedInspection ? "Outgroove Inspection" : "Outgroove",
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
  if (packagedInspection)
    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle("Outgroove Inspection");
    });
  window.once("ready-to-show", () => window.show());

  const databasePath = join(app.getPath("userData"), "outgroove.sqlite3");
  database = new CatalogDatabase(databasePath);
  scanCatalog = new WorkerScanCatalog(databasePath);
  qualityQuery = new WorkerLibraryQualityQuery(databasePath);
  const reader = new MusicMetadataReader();
  const writer = new SafeMetadataWriter(reader);
  const artworkEncoder = new ElectronArtworkThumbnailEncoder();
  const artwork = new LoadAlbumArtwork(database, artworkEncoder);
  const musicBrainz = new MusicBrainzClient(
    database,
    `Outgroove/${app.getVersion()} (https://github.com/leahfrom/outgroove)`,
  );
  const providerUserAgent = `Outgroove/${app.getVersion()} (https://github.com/leahfrom/outgroove)`;
  const acoustId = new AcoustIdClient(
    database,
    OUTGROOVE_ACOUSTID_API_KEY ?? undefined,
    providerUserAgent,
  );
  const fingerprinter = new FpcalcFingerprinter(
    resolveBundledFpcalcPath({
      platform: process.platform,
      architecture: process.arch,
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
    }),
  );
  const coverArtArchive = new CoverArtArchiveClient(
    database,
    `Outgroove/${app.getVersion()} (https://github.com/leahfrom/outgroove)`,
  );
  const artworkEditor = new EditAlbumArtwork(database, writer, artworkEncoder);
  const metadataRunner = new WorkerMetadataJobRunner();
  const scanner = new ScanLibrary(
    database,
    metadataRunner,
    new WorkerLibraryFileSystem(),
    scanCatalog,
  );
  const backup = new DatabaseBackupService(database, databasePath);
  const radar = new RefreshRadar(database, musicBrainz);
  radarBackground = new RadarBackgroundRefresh(
    database,
    radar,
    {
      isOnline: () => net.isOnline(),
      isOnBatteryPower: () => powerMonitor.isOnBatteryPower(),
    },
    (completed, total, detail) => {
      if (!window.isDestroyed())
        window.webContents.send(channels.jobProgress, {
          job: "radar",
          completed,
          total,
          detail,
        });
    },
    (settings) => {
      if (!window.isDestroyed())
        window.webContents.send(
          channels.radarBackgroundRefreshUpdated,
          settings,
        );
    },
    createElectronRadarNotifier(window),
  );
  registerIpc(ipcMain, {
    database,
    qualityQuery,
    backup,
    scanJobs: new ScanJobCoordinator(database, scanner),
    libraryRoots: new ManageLibraryRoots(database),
    artwork,
    albumCandidates: new FindAlbumCandidates(database, musicBrainz),
    trackIdentification: new IdentifyTrackByFingerprint(
      database,
      fingerprinter,
      acoustId,
    ),
    releaseArtwork: new FindReleaseArtwork(
      database,
      coverArtArchive,
      artworkEncoder,
      artworkEditor,
    ),
    favoriteArtists: new ManageFavoriteArtists(database, musicBrainz),
    radar,
    radarBackground,
    radarItemOpener: new OpenRadarItem(database, {
      open: (url) => shell.openExternal(url),
    }),
    editor: new EditAlbumTitle(database, writer),
    artworkEditor,
    artworkExporter: new ExportAlbumArtwork(database, artworkEncoder),
    folderArtworkCreator: new CreateAlbumFolderArtwork(
      database,
      artworkEncoder,
      { afterCreated: (albumId) => artwork.invalidate(albumId) },
    ),
    trackEditor: new EditTrackTags(database, writer),
    sync: new DeviceSync(database),
    window,
    restartApp: () => {
      app.relaunch();
      app.exit(0);
    },
  });

  if (packagedInspection?.fixtureLibraryRoot) {
    const fixtureRoot = packagedInspection.fixtureLibraryRoot;
    const root = database.addLibraryRoot(
      fixtureRoot,
      pathComparisonKey(fixtureRoot),
    );
    const result = await scanner.execute(root.id);
    if (result.parsed !== 2 || result.errors !== 0)
      throw new Error(
        "Packaged inspection could not seed its redistributable fixture Library.",
      );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    await window.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      packagedInspection
        ? {
            query: {
              outgrooveInspection: packagedInspection.sessionId,
            },
          }
        : undefined,
    );
  if (packagedInspection) {
    await writePackagedInspectionReadyMarker(packagedInspection, {
      pid: process.pid,
      appPath: app.getAppPath(),
      executablePath: app.getPath("exe"),
      databasePath,
    });
  }
  radarBackground.start();
  window.once("closed", () => {
    radarBackground?.stop();
  });
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
    // The loaded renderer owns the production query coordinator and may cancel
    // its active query as the visible Library view changes. Keep this packaged
    // worker check independent so renderer timing cannot supersede the smoke
    // assertion itself.
    const smokeQualityQuery = new WorkerLibraryQualityQuery(databasePath);
    try {
      const qualityPage = await smokeQualityQuery.query({
        query: "",
        offset: 0,
        limit: 20,
        qualityFilter: "all",
      });
      if (qualityPage.offset !== 0 || qualityPage.limit !== 20)
        throw new Error(
          "Packaged library data-quality worker returned an invalid page.",
        );
    } finally {
      await smokeQualityQuery.close();
    }
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
    const smokeFavorite = database.addFavoriteArtist({
      artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
      name: "Packaged Fixture Artist",
      sortName: "Packaged Fixture Artist",
      disambiguation: "isolated packaged smoke identity",
      type: "Group",
      country: "DE",
      area: "Berlin",
      score: 100,
    });
    database.commitRadarRefresh(
      smokeFavorite.id,
      [
        {
          releaseGroupId: "85f96c2e-3711-4e70-8bcc-1d37ca6d361d",
          representativeReleaseId: "cdb15a6d-8271-4dce-8497-d572ea9e3b68",
          title: "Packaged Radar Fixture",
          primaryType: "Album",
          secondaryTypes: [],
          firstReleaseDate: "2026",
          status: "Official",
          country: "DE",
        },
      ],
      {
        refreshedAt: new Date().toISOString(),
        providerFetchedAt: new Date().toISOString(),
        truncated: false,
      },
    );
    const backupPath = join(app.getPath("userData"), "smoke-backup.sqlite3");
    await backup.exportTo(backupPath);
    const verifiedBackup = new CatalogDatabase(backupPath);
    if (
      verifiedBackup.connection.pragma("integrity_check", { simple: true }) !==
      "ok"
    )
      throw new Error("Packaged database backup failed verification.");
    if (
      verifiedBackup.listFavoriteArtists()[0]?.musicBrainzArtistId !==
      "7c08e5aa-3d6a-480f-8763-156120bc9bd9"
    )
      throw new Error(
        "Packaged favorite-artist persistence was not retained in the verified backup.",
      );
    if (
      verifiedBackup.listRadarItems("all", "all", false, "2026-07-28").items[0]
        ?.title !== "Packaged Radar Fixture"
    )
      throw new Error(
        "Packaged Radar snapshot persistence was not retained in the verified backup.",
      );
    if (verifiedBackup.getRadarBackgroundRefreshSettings().enabled)
      throw new Error(
        "Packaged Radar background refresh was not safely disabled by default.",
      );
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
  radarBackground?.stop();
  void scanCatalog?.close();
  void qualityQuery?.close();
  database?.close();
});
