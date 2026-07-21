import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { migrations } from "../../src/main/adapters/database/migrations";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("database migration and backup", () => {
  it("keeps the shipped catalog-search migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "005_catalog_search.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 5);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("migrates an empty database and opens a verified backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-"));
    temporary.push(directory);
    const source = new CatalogDatabase(join(directory, "source.sqlite3"));
    expect(source.connection.pragma("user_version", { simple: true })).toBe(5);
    source.addLibraryRoot("/fixture/library", "/fixture/library");
    await source.backup(join(directory, "backup.sqlite3"));
    source.close();
    const backup = new CatalogDatabase(join(directory, "backup.sqlite3"));
    expect(
      backup.connection.prepare("PRAGMA integrity_check").pluck().get(),
    ).toBe("ok");
    expect(
      backup.connection
        .prepare("SELECT count(*) FROM library_roots")
        .pluck()
        .get(),
    ).toBe(1);
    backup.close();
  });

  it("marks an active persisted scan as interrupted when the database reopens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-jobs-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const first = new CatalogDatabase(path);
    const root = first.addLibraryRoot("/fixture/library", "/fixture/library");
    const job = first.createScanJob(root.id);
    first.updateScanJob(job.id, { state: "running", detail: "Scanning" });
    first.close();
    const reopened = new CatalogDatabase(path);
    expect(reopened.getLatestScanJob()).toMatchObject({
      id: job.id,
      state: "interrupted",
      error: "Outgroove closed before this scan finished.",
    });
    reopened.close();
  });

  it("migrates the v1 schema through every later migration without losing roots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v1-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    const firstMigration = migrations.find(
      (migration) => migration.version === 1,
    );
    if (!firstMigration) throw new Error("Version 1 migration missing");
    legacy.exec(firstMigration.sql);
    legacy.pragma("user_version = 1");
    legacy
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "/fixture/library",
        "/fixture/library",
        "2026-01-01T00:00:00.000Z",
      );
    legacy.close();
    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      5,
    );
    expect(migrated.listLibraryRoots()).toHaveLength(1);
    expect(
      migrated.connection.prepare("SELECT count(*) FROM jobs").pluck().get(),
    ).toBe(0);
    migrated.close();
  });

  it("upgrades the released v2 jobs schema without losing durable job history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v2-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 2))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 2");
    legacy
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "/fixture/library",
        "/fixture/library",
        "2026-01-01T00:00:00.000Z",
      );
    legacy
      .prepare(
        `INSERT INTO jobs (id, type, root_id, state, created_at, updated_at, finished_at)
         VALUES (?, 'scan', ?, 'completed', ?, ?, ?)`,
      )
      .run(
        "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T00:01:00.000Z",
      );
    legacy.close();
    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      5,
    );
    expect(migrated.getLatestScanJob()).toMatchObject({
      id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
      state: "completed",
    });
    migrated.close();
  });

  it("upgrades the released v3 catalog and preserves its library root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v3-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 3))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 3");
    legacy
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "/fixture/library",
        "/fixture/library",
        "2026-01-01T00:00:00.000Z",
      );
    legacy.close();

    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      5,
    );
    expect(migrated.listLibraryRoots()).toHaveLength(1);
    expect(
      migrated.connection
        .prepare("SELECT COUNT(*) FROM scan_directory_errors")
        .pluck()
        .get(),
    ).toBe(0);
    migrated.close();
  });

  it("upgrades the released v4 catalog and builds its search projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v4-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 4))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 4");
    legacy
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("root", "/fixture/library", "/fixture/library", "2026-01-01");
    legacy
      .prepare(
        "INSERT INTO albums (id, grouping_key, title, album_artist) VALUES (?, ?, ?, ?)",
      )
      .run("album", "legacy-album", "Legacy Album", "Legacy Artist");
    legacy
      .prepare(
        `INSERT INTO audio_files
         (id, root_id, path, path_key, size, modified_ms, signature, format, normalized_tags_json, scan_state, scanned_at)
         VALUES (?, ?, ?, ?, 1, 1, '1:1', 'FLAC', ?, 'ok', ?)`,
      )
      .run(
        "file",
        "root",
        "/fixture/library/needle.flac",
        "/fixture/library/needle.flac",
        JSON.stringify({ artist: "Legacy Track Artist" }),
        "2026-01-01",
      );
    legacy
      .prepare(
        "INSERT INTO tracks (id, file_id, album_id, title) VALUES (?, ?, ?, ?)",
      )
      .run("track", "file", "album", "Legacy Needle Track");
    legacy.close();

    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      5,
    );
    expect(
      migrated.queryLibrary({
        query: "Needle Track",
        view: "albums",
        offset: 0,
        limit: 10,
      }).albums[0]?.title,
    ).toBe("Legacy Album");
    expect(
      migrated.connection
        .prepare("SELECT COUNT(*) FROM catalog_search_documents")
        .pluck()
        .get(),
    ).toBe(1);
    migrated.close();
  });

  it("publishes directory errors atomically and preserves them across an abandoned scan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-errors-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      "/fixture/library",
      "/fixture/library",
    );
    database.beginScan(root.id);
    database.recordScanDirectoryError(
      root.id,
      "/fixture/library/old",
      "/fixture/library/old",
      "Old completed error",
    );
    database.finishScan(root.id);

    database.beginScan(root.id);
    database.recordScanDirectoryError(
      root.id,
      "/fixture/library/new",
      "/fixture/library/new",
      "Cancelled scan error",
    );
    database.abandonScan(root.id);
    expect(database.listScanErrors()).toEqual([
      {
        kind: "directory",
        path: "/fixture/library/old",
        message: "Old completed error",
      },
    ]);

    database.beginScan(root.id);
    database.finishScan(root.id);
    expect(database.listScanErrors()).toEqual([]);
    database.close();
  });
});
