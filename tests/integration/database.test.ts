import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { migrations } from "../../src/main/adapters/database/migrations";
import { diagnoseAlbum } from "../../src/shared/domain/album-diagnostics";

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

  it("keeps the shipped edit-undo migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "006_edit_undo.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 6);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped track-edit migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "007_track_tag_edits.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 7);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped track-undo migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "008_track_tag_undo.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 8);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped batch-edit migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "009_track_batch_edits.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 9);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped batch-undo migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "010_track_batch_undo.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 10);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped track-number sequence migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "011_track_number_sequence.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 11);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped stable album grouping migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "012_stable_album_grouping.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 12);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the shipped watched-root migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "013_watched_library_roots.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 13);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the audio technical-property migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "014_audio_technical_properties.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 14);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("keeps the saved Library-filter migration identical to its executable definition", () => {
    const normalized = (sql: string): string =>
      sql.replace(/\s+/gu, " ").trim();
    const file = readFileSync(
      join(process.cwd(), "migrations", "015_saved_library_filters.sql"),
      "utf8",
    );
    const executable = migrations.find((migration) => migration.version === 15);
    expect(executable).toBeDefined();
    expect(normalized(executable?.sql ?? "")).toBe(normalized(file));
  });

  it("migrates an empty database and opens a verified backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-"));
    temporary.push(directory);
    const source = new CatalogDatabase(join(directory, "source.sqlite3"));
    expect(source.connection.pragma("user_version", { simple: true })).toBe(15);
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

  it("migrates the released v13 catalog without losing durable root-linked state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v13-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 13))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 13");
    legacy
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES ('root', '/fixture', '/fixture', '2026-01-01')",
      )
      .run();
    legacy
      .prepare(
        "INSERT INTO albums (id, grouping_key, title, album_artist) VALUES ('album', 'group', 'Album', 'Artist')",
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO audio_files
         (id, root_id, path, path_key, size, modified_ms, signature, scan_state, scanned_at)
         VALUES ('file', 'root', '/fixture/track.mp3', '/fixture/track.mp3', 1, 1, '1:1', 'ok', '2026-01-01')`,
      )
      .run();
    legacy
      .prepare(
        "INSERT INTO tracks (id, file_id, album_id, title) VALUES ('track', 'file', 'album', 'Track')",
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at, completed_at)
         VALUES ('operation', 'album', 'Album', 'hash', 'completed', '2026-01-01', '2026-01-01')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO tag_snapshots
         (id, operation_id, file_id, before_tags_json, after_tags_json, verified)
         VALUES ('snapshot', 'operation', 'file', '{}', '{}', 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO sync_profiles (id, name, target_path, album_id, created_at)
         VALUES ('profile', 'DAP', '/target', 'album', '2026-01-01')`,
      )
      .run();
    legacy.close();

    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      15,
    );
    expect(migrated.listLibraryRoots()).toHaveLength(1);
    expect(
      migrated.connection
        .prepare("SELECT removed_at FROM library_roots")
        .pluck()
        .get(),
    ).toBeNull();
    expect(
      migrated.connection
        .prepare(
          `SELECT codec, bitrate, sample_rate, bit_depth, channels,
             technical_properties_version
           FROM audio_files`,
        )
        .get(),
    ).toEqual({
      codec: null,
      bitrate: null,
      sample_rate: null,
      bit_depth: null,
      channels: null,
      technical_properties_version: 0,
    });
    for (const table of [
      "audio_files",
      "edit_operations",
      "tag_snapshots",
      "sync_profiles",
    ])
      expect(
        migrated.connection
          .prepare(`SELECT COUNT(*) FROM ${table}`)
          .pluck()
          .get(),
      ).toBe(1);
    migrated.close();
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
      15,
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
      15,
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
      15,
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
      15,
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

  it("upgrades the released v6 edit history without losing snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v6-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 6))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 6");
    legacy
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("root", "/fixture/library", "/fixture/library", "2026-01-01");
    legacy
      .prepare(
        "INSERT INTO albums (id, grouping_key, title, album_artist) VALUES (?, ?, ?, ?)",
      )
      .run("album", "fixture-album", "Edited Album", "Fixture Artist");
    const tags = {
      title: "Track",
      album: "Edited Album",
      artist: "Fixture Artist",
      albumArtist: "Fixture Artist",
    };
    legacy
      .prepare(
        `INSERT INTO audio_files
         (id, root_id, path, path_key, size, modified_ms, signature, format, normalized_tags_json, scan_state, scanned_at)
         VALUES ('file', 'root', '/fixture/library/track.mp3', '/fixture/library/track.mp3', 1, 1, '1:1', 'MP3', ?, 'ok', '2026-01-01')`,
      )
      .run(JSON.stringify(tags));
    legacy
      .prepare(
        "INSERT INTO tracks (id, file_id, album_id, title) VALUES ('track', 'file', 'album', 'Track')",
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at, completed_at)
         VALUES ('operation', 'album', 'Edited Album', 'hash', 'completed', '2026-01-01', '2026-01-01')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO tag_snapshots
         (id, operation_id, file_id, before_tags_json, after_tags_json, verified)
         VALUES ('snapshot', 'operation', 'file', ?, ?, 1)`,
      )
      .run(
        JSON.stringify({ ...tags, album: "Original Album" }),
        JSON.stringify(tags),
      );
    legacy.close();

    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      15,
    );
    expect(migrated.getEditOperation("operation")).toMatchObject({
      kind: "album-title-edit",
      source_operation_id: null,
    });
    expect(migrated.listEditHistory("album")).toMatchObject([
      { operationId: "operation", verifiedFiles: 1, failedFiles: 0 },
    ]);
    expect(migrated.listSnapshots("operation")[0]?.before.album).toBe(
      "Original Album",
    );
    expect(migrated.connection.pragma("foreign_key_check")).toEqual([]);
    migrated.close();
  });

  it("upgrades the v10 batch-undo schema without losing proposals or snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v10-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 10))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 10");
    legacy.exec(`
      INSERT INTO library_roots (id, path, path_key, created_at)
        VALUES ('root', '/fixture/library', '/fixture/library', '2026-01-01');
      INSERT INTO albums (id, grouping_key, title, album_artist)
        VALUES ('album', 'fixture-album', 'Album', 'Artist');
      INSERT INTO audio_files
        (id, root_id, path, path_key, size, modified_ms, signature, format,
         normalized_tags_json, scan_state, scanned_at)
        VALUES ('file', 'root', '/fixture/library/track.mp3',
          '/fixture/library/track.mp3', 1, 1, '1:1', 'MP3',
          '{"title":"Edited","album":"Album","artist":"Artist","albumArtist":"Artist","trackNumber":1,"discNumber":1,"year":"2026"}',
          'ok', '2026-01-01');
      INSERT INTO tracks (id, file_id, album_id, title)
        VALUES ('track', 'file', 'album', 'Edited');
      INSERT INTO edit_operations
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind, target_file_id, preview_tags_json,
         proposed_tags_json)
        VALUES ('operation', 'album', 'Batch metadata: artist', 'hash',
          'completed', '2026-01-01', '2026-01-01', 'track-tags-batch-edit', NULL,
          '[{"fileId":"file","tags":{"artist":"Artist"}}]',
          '{"artist":"Edited Artist"}');
      INSERT INTO tag_snapshots
        (id, operation_id, file_id, before_tags_json, after_tags_json, verified)
        VALUES ('snapshot', 'operation', 'file', '{"title":"Original"}',
          '{"title":"Edited"}', 1);
    `);
    legacy.close();

    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      15,
    );
    expect(migrated.getEditOperation("operation")).toMatchObject({
      kind: "track-tags-batch-edit",
      target_file_id: null,
      proposed_tags_json: '{"artist":"Edited Artist"}',
    });
    expect(migrated.listSnapshots("operation")).toMatchObject([
      { fileId: "file", verified: true },
    ]);
    expect(migrated.connection.pragma("foreign_key_check")).toEqual([]);
    migrated.close();
  });

  it("merges only same-folder v11 album-artist splits and preserves durable references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-v11-"));
    temporary.push(directory);
    const path = join(directory, "catalog.sqlite3");
    const legacy = new Database(path);
    for (const migration of migrations.filter((item) => item.version <= 11))
      legacy.exec(migration.sql);
    legacy.pragma("user_version = 11");
    legacy.exec(`
      INSERT INTO library_roots (id, path, path_key, created_at)
        VALUES ('root', '/fixture/library', '/fixture/library', '2026-01-01');
      INSERT INTO albums (id, grouping_key, title, album_artist) VALUES
        ('album-a', 'artist-a-album', 'Shared Album', 'Artist A'),
        ('album-b', 'artist-b-album', 'Shared Album', 'Artist B'),
        ('album-c', 'artist-c-album', 'Shared Album', 'Artist C');
      INSERT INTO audio_files
        (id, root_id, path, path_key, size, modified_ms, signature, format,
         normalized_tags_json, scan_state, scanned_at) VALUES
        ('file-a', 'root', '/fixture/library/shared/01.flac', '/fixture/library/shared/01.flac', 1, 1, '1:1', 'FLAC',
         '{"title":"First","album":"Shared Album","artist":"Artist A","albumArtist":"Artist A","trackNumber":1,"discNumber":1,"year":"2026"}', 'ok', '2026-01-01'),
        ('file-b', 'root', '/fixture/library/shared/02.flac', '/fixture/library/shared/02.flac', 1, 1, '1:1', 'FLAC',
         '{"title":"Second","album":"Shared Album","artist":"Artist B","albumArtist":"Artist B","trackNumber":2,"discNumber":1,"year":"2026"}', 'ok', '2026-01-01'),
        ('file-c', 'root', '/fixture/library/other/01.flac', '/fixture/library/other/01.flac', 1, 1, '1:1', 'FLAC',
         '{"title":"Other","album":"Shared Album","artist":"Artist C","albumArtist":"Artist C","trackNumber":1,"discNumber":1,"year":"2026"}', 'ok', '2026-01-01');
      INSERT INTO tracks (id, file_id, album_id, title, track_number, disc_number) VALUES
        ('track-a', 'file-a', 'album-a', 'First', 1, 1),
        ('track-b', 'file-b', 'album-b', 'Second', 2, 1),
        ('track-c', 'file-c', 'album-c', 'Other', 1, 1);
      INSERT INTO edit_operations
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind)
        VALUES ('operation', 'album-b', 'Batch metadata: albumArtist', 'hash',
          'completed', '2026-01-01', '2026-01-01', 'track-tags-batch-edit');
      INSERT INTO sync_profiles (id, name, target_path, album_id, created_at)
        VALUES ('profile', 'Fixture DAP', '/fixture/dap', 'album-b', '2026-01-01');
    `);
    legacy.close();

    const migrated = new CatalogDatabase(path);
    expect(migrated.connection.pragma("user_version", { simple: true })).toBe(
      15,
    );
    const albums = migrated.listAlbums();
    expect(albums).toHaveLength(2);
    const merged = albums.find((album) => album.id === "album-a");
    expect(merged?.tracks.map((track) => track.id)).toEqual([
      "file-a",
      "file-b",
    ]);
    expect(
      merged &&
        diagnoseAlbum(merged).some(
          (finding) => finding.kind === "inconsistent-album-artist",
        ),
    ).toBe(true);
    expect(migrated.getSyncProfile("profile")?.album_id).toBe("album-a");
    expect(migrated.getEditOperation("operation")?.album_id).toBe("album-a");
    expect(
      migrated.connection
        .prepare(
          "SELECT album_id FROM album_grouping_aliases ORDER BY grouping_key",
        )
        .pluck()
        .all(),
    ).toEqual(["album-a", "album-a", "album-c"]);
    expect(
      migrated.connection
        .prepare("SELECT album_id FROM album_folder_aliases")
        .pluck()
        .all()
        .sort(),
    ).toEqual(["album-a", "album-c"]);
    expect(
      migrated.connection
        .prepare(
          "SELECT value FROM catalog_metadata WHERE key='album-grouping-reconciliation'",
        )
        .pluck()
        .get(),
    ).toBe("complete");
    expect(migrated.connection.pragma("foreign_key_check")).toEqual([]);
    migrated.close();
  });

  it("keeps a verified partial album-artist edit in its established album", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-grouping-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(directory, directory);
    const scannedFile = (title: string, trackNumber: number) => ({
      path: join(directory, "Album", `${trackNumber}.flac`),
      size: 100,
      modifiedMs: 1,
      format: "FLAC",
      durationSeconds: 60,
      tags: {
        title,
        album: "Album",
        artist: "Artist",
        albumArtist: "Artist",
        trackNumber,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    });
    const first = scannedFile("First", 1);
    const second = scannedFile("Second", 2);
    const firstId = database.upsertScannedFile(root.id, first.path, first);
    database.upsertScannedFile(root.id, second.path, second);
    const albumId = database.listAlbums()[0]?.id;
    if (!albumId) throw new Error("Fixture album missing");
    const profile = database.createSyncProfile(
      "Fixture DAP",
      join(directory, "dap"),
      albumId,
    );

    database.updateFileAfterEdit(firstId, {
      ...first,
      modifiedMs: 2,
      tags: { ...first.tags, albumArtist: "Corrected Artist" },
    });

    const albums = database.listAlbums();
    expect(albums).toHaveLength(1);
    const album = albums[0];
    if (!album) throw new Error("Edited fixture album missing");
    expect(album.id).toBe(albumId);
    const finding = diagnoseAlbum(album).find(
      (candidate) => candidate.kind === "inconsistent-album-artist",
    );
    expect(finding?.affectedTrackIds).toContain(firstId);
    expect(database.getSyncProfile(profile.id)?.album_id).toBe(albumId);
    database.close();
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
