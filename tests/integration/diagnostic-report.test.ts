import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import {
  type DiagnosticEnvironment,
  ExportDiagnosticReport,
} from "../../src/main/application/export-diagnostic-report";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];
const environment: DiagnosticEnvironment = {
  appVersion: "0.16.0-test",
  packaged: true,
  platform: "darwin",
  architecture: "arm64",
  runtimeVersions: {
    electron: "fixture-electron",
    chrome: "fixture-chrome",
    node: "fixture-node",
  },
};

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("path-redacted diagnostic report", () => {
  it("exports verified aggregate support data without catalog or provider content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-diagnostics-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const privateRoot = "/Users/Fixture Person/秘密 music";
    const privateFile = join(privateRoot, "Private Artist - Secret Song.mp3");
    const privateTarget = "/Volumes/Fixture Owner's DAP";
    const root = database.addLibraryRoot(
      privateRoot,
      pathComparisonKey(privateRoot),
    );
    database.upsertScannedFile(root.id, pathComparisonKey(privateFile), {
      path: privateFile,
      size: 128,
      modifiedMs: 1,
      format: "MPEG",
      durationSeconds: 60,
      tags: {
        title: "Secret Song",
        album: "Private Album",
        artist: "Private Artist",
        albumArtist: "Private Artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [{ id: "TXXX", value: "private native value" }],
    });
    const album = database.listAlbums()[0];
    if (!album) throw new Error("Fixture album missing.");
    database.createSyncProfile("Private DAP name", privateTarget, [album.id]);
    database.createSavedLibraryFilter("Private filter name", {
      query: "Secret Song",
      view: "albums",
    });
    database.putProviderCache({
      provider: "musicbrainz",
      requestKey: "private-request-key",
      responseSchemaVersion: 1,
      status: 200,
      fetchedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-07-31T00:00:00.000Z",
      payloadJson: '{"title":"Private provider release"}',
    });
    const service = new ExportDiagnosticReport(
      database,
      environment,
      () => new Date("2026-07-30T12:34:56.000Z"),
    );
    const destination = join(directory, "report.json");

    const result = await service.exportTo(destination);
    const bytes = await readFile(destination);
    const text = bytes.toString("utf8");
    const report = JSON.parse(text) as ReturnType<
      ExportDiagnosticReport["createReport"]
    >;

    expect(result).toEqual({
      path: destination,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-07-30T12:34:56.000Z",
      application: {
        name: "Outgroove",
        version: "0.16.0-test",
        packaged: true,
      },
      system: {
        platform: "darwin",
        architecture: "arm64",
        electron: "fixture-electron",
        chrome: "fixture-chrome",
        node: "fixture-node",
      },
      database: {
        schemaVersion: 25,
        integrity: "ok",
        counts: {
          watchedLibraryRoots: 1,
          audioFiles: 1,
          availableAudioFiles: 1,
          albums: 1,
          tracks: 1,
          syncProfiles: 1,
          savedLibraryFilters: 1,
          providerCacheEntries: 1,
        },
      },
      privacy: {
        paths: "redacted",
        filenames: "excluded",
        tags: "excluded",
        providerPayloads: "excluded",
        stableIdentifiers: "excluded",
        errorMessages: "excluded",
      },
    });
    for (const privateValue of [
      privateRoot,
      privateFile,
      privateTarget,
      "Fixture Person",
      "Secret Song",
      "Private Album",
      "Private Artist",
      "private native value",
      "Private DAP name",
      "Private filter name",
      "private-request-key",
      "Private provider release",
      root.id,
      album.id,
    ])
      expect(text).not.toContain(privateValue);
    database.close();
  });

  it("replaces an existing report through a verified same-directory write", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "outgroove-diagnostics-replace-"),
    );
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const destination = join(directory, "report.json");
    await writeFile(destination, "previous report");
    const service = new ExportDiagnosticReport(database, environment);

    const result = await service.exportTo(destination);
    expect(result.path).toBe(destination);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readFile(destination, "utf8")).toContain(
      '"paths": "redacted"',
    );
    expect((await readFile(destination, "utf8")).endsWith("\n")).toBeTruthy();
    database.close();
  });

  it("restores an existing report when publication is interrupted", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "outgroove-diagnostics-interrupted-"),
    );
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const destination = join(directory, "report.json");
    await writeFile(destination, "previous report");
    const service = new ExportDiagnosticReport(
      database,
      environment,
      () => new Date("2026-07-30T12:34:56.000Z"),
      {
        afterPublish: () => {
          throw new Error("fixture interruption");
        },
      },
    );

    await expect(service.exportTo(destination)).rejects.toThrow(
      "fixture interruption",
    );
    expect(await readFile(destination, "utf8")).toBe("previous report");
    expect(
      (await readdir(directory)).filter((name) => name.includes(".outgroove-")),
    ).toEqual([]);
    database.close();
  });

  it("rejects renderer-style relative destinations before writing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "outgroove-diagnostics-relative-"),
    );
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const service = new ExportDiagnosticReport(database, environment);

    await expect(service.exportTo("renderer-selected.json")).rejects.toThrow(
      "must be absolute",
    );
    database.close();
  });
});
