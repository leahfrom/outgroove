import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type {
  LibraryPageDto,
  LibraryRootDto,
  ScanJobDto,
  ScanJobState,
  ScanResultDto,
} from "../../../shared/contracts/api";
import type {
  CatalogAlbum,
  CatalogTrack,
  NormalizedTags,
  ScannedAudioFile,
} from "../../../shared/domain/catalog";
import { albumGroupingKey, sortTracks } from "../../../shared/domain/catalog";
import { migrations } from "./migrations";

interface AudioFileRow {
  id: string;
  root_id: string;
  path: string;
  size: number;
  modified_ms: number;
  signature: string;
  format: string | null;
  duration_seconds: number | null;
  normalized_tags_json: string | null;
  native_tags_json: string | null;
  scan_error: string | null;
}

interface ScanJobRow {
  id: string;
  root_id: string;
  state: ScanJobState;
  completed: number;
  total: number;
  detail: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

function mapScanJob(row: ScanJobRow): ScanJobDto {
  return {
    id: row.id,
    rootId: row.root_id,
    state: row.state,
    completed: row.completed,
    total: row.total,
    detail: row.detail,
    result: row.result_json
      ? (JSON.parse(row.result_json) as ScanResultDto)
      : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export interface StoredFile extends AudioFileRow {
  readonly tags: NormalizedTags;
}

export class CatalogDatabase {
  readonly connection: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new Database(path);
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("journal_mode = WAL");
    this.migrate();
    this.interruptOrphanedJobs();
  }

  close(): void {
    if (this.connection.open) this.connection.close();
  }

  private migrate(): void {
    const current = this.connection.pragma("user_version", {
      simple: true,
    }) as number;
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      this.connection.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection.pragma(`user_version = ${migration.version}`);
      })();
    }
  }

  private interruptOrphanedJobs(): void {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `UPDATE jobs SET state='interrupted', error='Outgroove closed before this scan finished.', updated_at=?, finished_at=?
         WHERE state IN ('queued', 'running', 'cancelling')`,
      )
      .run(now, now);
  }

  backup(destinationPath: string): Promise<void> {
    mkdirSync(dirname(destinationPath), { recursive: true });
    return this.connection.backup(destinationPath).then(() => undefined);
  }

  addLibraryRoot(
    path: string,
    pathKey: string,
  ): { id: string; path: string; lastScanAt: string | null } {
    const existing = this.connection
      .prepare(
        "SELECT id, path, last_scan_at FROM library_roots WHERE path_key = ?",
      )
      .get(pathKey) as
      { id: string; path: string; last_scan_at: string | null } | undefined;
    if (existing)
      return {
        id: existing.id,
        path: existing.path,
        lastScanAt: existing.last_scan_at,
      };
    const id = randomUUID();
    this.connection
      .prepare(
        "INSERT INTO library_roots (id, path, path_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, path, pathKey, new Date().toISOString());
    return { id, path, lastScanAt: null };
  }

  getLibraryRoot(id: string): { id: string; path: string } | undefined {
    return this.connection
      .prepare("SELECT id, path FROM library_roots WHERE id = ?")
      .get(id) as { id: string; path: string } | undefined;
  }

  listLibraryRoots(): readonly LibraryRootDto[] {
    return this.connection
      .prepare(
        "SELECT id, path, last_scan_at AS lastScanAt FROM library_roots ORDER BY created_at",
      )
      .all() as LibraryRootDto[];
  }

  createScanJob(rootId: string): ScanJobDto {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO jobs (id, type, root_id, state, created_at, updated_at)
         VALUES (?, 'scan', ?, 'queued', ?, ?)`,
      )
      .run(id, rootId, now, now);
    const created = this.getScanJob(id);
    if (!created) throw new Error("Created scan job could not be read.");
    return created;
  }

  updateScanJob(
    id: string,
    update: {
      state?: ScanJobState;
      completed?: number;
      total?: number;
      detail?: string;
      result?: ScanResultDto | null;
      error?: string | null;
      finished?: boolean;
    },
  ): ScanJobDto {
    const current = this.getScanJob(id);
    if (!current) throw new Error("Scan job does not exist.");
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `UPDATE jobs SET state=?, completed=?, total=?, detail=?, result_json=?, error=?, updated_at=?, finished_at=? WHERE id=?`,
      )
      .run(
        update.state ?? current.state,
        update.completed ?? current.completed,
        update.total ?? current.total,
        update.detail ?? current.detail,
        update.result === undefined
          ? current.result && JSON.stringify(current.result)
          : update.result && JSON.stringify(update.result),
        update.error === undefined ? current.error : update.error,
        now,
        update.finished ? now : current.finishedAt,
        id,
      );
    const updated = this.getScanJob(id);
    if (!updated) throw new Error("Updated scan job could not be read.");
    return updated;
  }

  getScanJob(id: string): ScanJobDto | undefined {
    const row = this.connection
      .prepare("SELECT * FROM jobs WHERE id=? AND type='scan'")
      .get(id) as ScanJobRow | undefined;
    return row && mapScanJob(row);
  }

  getLatestScanJob(): ScanJobDto | null {
    const row = this.connection
      .prepare(
        "SELECT * FROM jobs WHERE type='scan' ORDER BY created_at DESC LIMIT 1",
      )
      .get() as ScanJobRow | undefined;
    return row ? mapScanJob(row) : null;
  }

  getActiveScanJob(rootId: string): ScanJobDto | null {
    const row = this.connection
      .prepare(
        `SELECT * FROM jobs WHERE type='scan' AND root_id=? AND state IN ('queued', 'running', 'cancelling')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(rootId) as ScanJobRow | undefined;
    return row ? mapScanJob(row) : null;
  }

  getFileByPathKey(pathKey: string): AudioFileRow | undefined {
    return this.connection
      .prepare("SELECT * FROM audio_files WHERE path_key = ?")
      .get(pathKey) as AudioFileRow | undefined;
  }

  upsertScannedFile(
    rootId: string,
    pathKey: string,
    file: ScannedAudioFile,
  ): string {
    const existing = this.getFileByPathKey(pathKey);
    const fileId = existing?.id ?? randomUUID();
    const signature = `${file.size}:${Math.trunc(file.modifiedMs)}`;
    const parentFolder = file.path.replace(/[\\/][^\\/]+$/u, "");
    const groupingKey = albumGroupingKey(file.tags, parentFolder);
    const album = this.connection
      .prepare("SELECT id FROM albums WHERE grouping_key = ?")
      .get(groupingKey) as { id: string } | undefined;
    const albumId = album?.id ?? randomUUID();
    const now = new Date().toISOString();
    this.connection.transaction(() => {
      this.connection
        .prepare(
          `INSERT INTO albums (id, grouping_key, title, album_artist) VALUES (?, ?, ?, ?)
        ON CONFLICT(grouping_key) DO UPDATE SET title = excluded.title, album_artist = excluded.album_artist`,
        )
        .run(
          albumId,
          groupingKey,
          file.tags.album,
          file.tags.albumArtist || file.tags.artist,
        );
      this.connection
        .prepare(
          `INSERT INTO audio_files
        (id, root_id, path, path_key, size, modified_ms, signature, format, duration_seconds, normalized_tags_json, native_tags_json, scan_state, scan_error, scanned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?)
        ON CONFLICT(id) DO UPDATE SET path=excluded.path, path_key=excluded.path_key, size=excluded.size, modified_ms=excluded.modified_ms,
          signature=excluded.signature, format=excluded.format, duration_seconds=excluded.duration_seconds, normalized_tags_json=excluded.normalized_tags_json,
          native_tags_json=excluded.native_tags_json, scan_state='ok', scan_error=NULL, scanned_at=excluded.scanned_at`,
        )
        .run(
          fileId,
          rootId,
          file.path,
          pathKey,
          file.size,
          file.modifiedMs,
          signature,
          file.format,
          file.durationSeconds,
          JSON.stringify(file.tags),
          JSON.stringify(file.nativeTags),
          now,
        );
      this.connection
        .prepare(
          `INSERT INTO tracks (id, file_id, album_id, title, track_number, disc_number) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET album_id=excluded.album_id, title=excluded.title, track_number=excluded.track_number, disc_number=excluded.disc_number`,
        )
        .run(
          randomUUID(),
          fileId,
          albumId,
          file.tags.title,
          file.tags.trackNumber,
          file.tags.discNumber,
        );
    })();
    return fileId;
  }

  upsertScanError(
    rootId: string,
    path: string,
    pathKey: string,
    size: number,
    modifiedMs: number,
    message: string,
  ): void {
    const existing = this.getFileByPathKey(pathKey);
    this.connection
      .prepare(
        `INSERT INTO audio_files
      (id, root_id, path, path_key, size, modified_ms, signature, scan_state, scan_error, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'error', ?, ?)
      ON CONFLICT(id) DO UPDATE SET size=excluded.size, modified_ms=excluded.modified_ms, signature=excluded.signature,
        scan_state='error', scan_error=excluded.scan_error, scanned_at=excluded.scanned_at`,
      )
      .run(
        existing?.id ?? randomUUID(),
        rootId,
        path,
        pathKey,
        size,
        modifiedMs,
        `${size}:${Math.trunc(modifiedMs)}`,
        message,
        new Date().toISOString(),
      );
  }

  finishScan(rootId: string, seenPathKeys: readonly string[]): void {
    this.connection.transaction(() => {
      this.connection
        .prepare("UPDATE library_roots SET last_scan_at = ? WHERE id = ?")
        .run(new Date().toISOString(), rootId);
      if (seenPathKeys.length === 0) {
        this.connection
          .prepare(
            "UPDATE audio_files SET scan_state='missing' WHERE root_id = ?",
          )
          .run(rootId);
      } else {
        const placeholders = seenPathKeys.map(() => "?").join(",");
        this.connection
          .prepare(
            `UPDATE audio_files SET scan_state='missing' WHERE root_id = ? AND path_key NOT IN (${placeholders})`,
          )
          .run(rootId, ...seenPathKeys);
      }
    })();
  }

  listScanErrors(): readonly { path: string; message: string }[] {
    return this.connection
      .prepare(
        "SELECT path, scan_error AS message FROM audio_files WHERE scan_state = 'error' ORDER BY path",
      )
      .all() as { path: string; message: string }[];
  }

  queryLibrary(request: {
    query: string;
    view: "albums" | "scan-errors";
    offset: number;
    limit: number;
  }): LibraryPageDto {
    const escaped = request.query.replace(/[\\%_]/gu, "\\$&");
    const pattern = `%${escaped}%`;
    if (request.view === "scan-errors") {
      const search = request.query
        ? ` AND (path LIKE ? ESCAPE '\\' COLLATE NOCASE OR scan_error LIKE ? ESCAPE '\\' COLLATE NOCASE)`
        : "";
      const searchParameters = request.query ? [pattern, pattern] : [];
      const totalItems = this.connection
        .prepare(
          `SELECT COUNT(*) FROM audio_files WHERE scan_state='error'${search}`,
        )
        .pluck()
        .get(...searchParameters) as number;
      const scanErrors = this.connection
        .prepare(
          `SELECT path, scan_error AS message FROM audio_files WHERE scan_state='error'${search}
           ORDER BY path LIMIT ? OFFSET ?`,
        )
        .all(...searchParameters, request.limit, request.offset) as {
        path: string;
        message: string;
      }[];
      return {
        albums: [],
        scanErrors,
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    const search = request.query
      ? ` AND (a.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR a.album_artist LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR t.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR f.path LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR f.format LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR json_extract(f.normalized_tags_json, '$.artist') LIKE ? ESCAPE '\\' COLLATE NOCASE)`
      : "";
    const searchParameters = request.query
      ? [pattern, pattern, pattern, pattern, pattern, pattern]
      : [];
    const from = ` FROM albums a JOIN tracks t ON t.album_id=a.id JOIN audio_files f ON f.id=t.file_id
      WHERE f.scan_state='ok'${search}`;
    const totalItems = this.connection
      .prepare(`SELECT COUNT(DISTINCT a.id)${from}`)
      .pluck()
      .get(...searchParameters) as number;
    const albumIds = this.connection
      .prepare(
        `SELECT DISTINCT a.id, a.album_artist, a.title${from}
         ORDER BY a.album_artist, a.title, a.id LIMIT ? OFFSET ?`,
      )
      .all(...searchParameters, request.limit, request.offset)
      .map((row) => (row as { id: string }).id);
    return {
      albums: this.listAlbumsByIds(albumIds),
      scanErrors: [],
      totalItems,
      offset: request.offset,
      limit: request.limit,
    };
  }

  listAlbums(): readonly CatalogAlbum[] {
    return this.listAlbumsByIds();
  }

  private listAlbumsByIds(ids?: readonly string[]): readonly CatalogAlbum[] {
    if (ids?.length === 0) return [];
    const selection = ids
      ? ` AND a.id IN (${ids.map(() => "?").join(",")})`
      : "";
    const rows = this.connection
      .prepare(
        `SELECT a.id AS album_id, a.title AS album_title, a.album_artist,
      f.*, t.id AS track_id FROM albums a JOIN tracks t ON t.album_id=a.id JOIN audio_files f ON f.id=t.file_id
      WHERE f.scan_state='ok'${selection} ORDER BY a.album_artist, a.title, a.id, t.disc_number, t.track_number, f.path`,
      )
      .all(...(ids ?? [])) as (AudioFileRow & {
      album_id: string;
      album_title: string;
      album_artist: string;
      track_id: string;
    })[];
    const albums = new Map<
      string,
      { id: string; title: string; albumArtist: string; tracks: CatalogTrack[] }
    >();
    for (const row of rows) {
      const tags = JSON.parse(
        row.normalized_tags_json ?? "{}",
      ) as NormalizedTags;
      const album = albums.get(row.album_id) ?? {
        id: row.album_id,
        title: row.album_title,
        albumArtist: row.album_artist,
        tracks: [],
      };
      album.tracks.push({
        id: row.id,
        path: row.path,
        size: row.size,
        modifiedMs: row.modified_ms,
        format: row.format ?? "unknown",
        durationSeconds: row.duration_seconds,
        tags,
        nativeTags: JSON.parse(
          row.native_tags_json ?? "[]",
        ) as CatalogTrack["nativeTags"],
        scanError: row.scan_error,
      });
      albums.set(row.album_id, album);
    }
    return [...albums.values()].map((album) => ({
      ...album,
      tracks: sortTracks(album.tracks),
    }));
  }

  getAlbum(id: string): CatalogAlbum | undefined {
    return this.listAlbums().find((album) => album.id === id);
  }

  createEditOperation(
    albumId: string,
    proposedTitle: string,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        "INSERT INTO edit_operations (id, album_id, proposed_title, confirmation_hash, state, created_at) VALUES (?, ?, ?, ?, 'previewed', ?)",
      )
      .run(
        id,
        albumId,
        proposedTitle,
        confirmationHash,
        new Date().toISOString(),
      );
    return id;
  }

  getEditOperation(id: string):
    | {
        id: string;
        album_id: string;
        proposed_title: string;
        confirmation_hash: string;
        state: string;
      }
    | undefined {
    return this.connection
      .prepare(
        "SELECT id, album_id, proposed_title, confirmation_hash, state FROM edit_operations WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          album_id: string;
          proposed_title: string;
          confirmation_hash: string;
          state: string;
        }
      | undefined;
  }

  beginEdit(id: string): boolean {
    return (
      this.connection
        .prepare(
          "UPDATE edit_operations SET state='applying' WHERE id=? AND state='previewed'",
        )
        .run(id).changes === 1
    );
  }

  saveSnapshot(
    operationId: string,
    fileId: string,
    before: NormalizedTags,
    after: NormalizedTags,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        "INSERT INTO tag_snapshots (id, operation_id, file_id, before_tags_json, after_tags_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        id,
        operationId,
        fileId,
        JSON.stringify(before),
        JSON.stringify(after),
      );
    return id;
  }

  finishSnapshot(id: string, verified: boolean, error: string | null): void {
    this.connection
      .prepare("UPDATE tag_snapshots SET verified=?, error=? WHERE id=?")
      .run(verified ? 1 : 0, error, id);
  }

  finishEdit(id: string, successful: boolean): void {
    this.connection
      .prepare("UPDATE edit_operations SET state=?, completed_at=? WHERE id=?")
      .run(successful ? "completed" : "failed", new Date().toISOString(), id);
  }

  updateFileAfterEdit(fileId: string, file: ScannedAudioFile): void {
    const row = this.connection
      .prepare("SELECT root_id, path_key FROM audio_files WHERE id=?")
      .get(fileId) as { root_id: string; path_key: string };
    this.upsertScannedFile(row.root_id, row.path_key, file);
  }

  createSyncProfile(
    name: string,
    targetPath: string,
    albumId: string,
  ): { id: string; name: string; targetPath: string } {
    const id = randomUUID();
    this.connection
      .prepare(
        "INSERT INTO sync_profiles (id, name, target_path, album_id, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, name, targetPath, albumId, new Date().toISOString());
    return { id, name, targetPath };
  }

  getSyncProfile(
    id: string,
  ):
    | { id: string; name: string; target_path: string; album_id: string }
    | undefined {
    return this.connection
      .prepare(
        "SELECT id, name, target_path, album_id FROM sync_profiles WHERE id=?",
      )
      .get(id) as
      | { id: string; name: string; target_path: string; album_id: string }
      | undefined;
  }

  getLatestManifest(profileId: string): { manifest_json: string } | undefined {
    return this.connection
      .prepare(
        "SELECT manifest_json FROM sync_manifests WHERE profile_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(profileId) as { manifest_json: string } | undefined;
  }

  saveManifest(
    profileId: string,
    targetPath: string,
    manifest: {
      entries: readonly {
        sourceFileId: string;
        relativeDestination: string;
        signature: string;
        size: number;
      }[];
    },
  ): void {
    const manifestId = randomUUID();
    this.connection.transaction(() => {
      this.connection
        .prepare(
          "INSERT INTO sync_manifests (id, profile_id, target_path, created_at, manifest_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          manifestId,
          profileId,
          targetPath,
          new Date().toISOString(),
          JSON.stringify(manifest),
        );
      const insert = this.connection.prepare(
        "INSERT INTO sync_entries (id, manifest_id, source_file_id, relative_destination, source_signature, size) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const entry of manifest.entries)
        insert.run(
          randomUUID(),
          manifestId,
          entry.sourceFileId,
          entry.relativeDestination,
          entry.signature,
          entry.size,
        );
    })();
  }
}
