import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type {
  LibraryPageDto,
  LibraryRootDto,
  ScanErrorDto,
  ScanJobDto,
  ScanJobState,
  ScanResultDto,
  TagEditHistoryItemDto,
} from "../../../shared/contracts/api";
import type {
  CatalogAlbum,
  CatalogTrack,
  NormalizedTags,
  ScannedAudioFile,
} from "../../../shared/domain/catalog";
import { albumGroupingKey, sortTracks } from "../../../shared/domain/catalog";
import type { TrackTagChanges } from "../../../shared/domain/tag-edit";
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
  scan_state: "ok" | "error" | "missing";
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

interface ScanStatements {
  readonly getFileByPathKey: Database.Statement;
  readonly getAlbumByGroupingKey: Database.Statement;
  readonly upsertAlbum: Database.Statement;
  readonly upsertAudioFile: Database.Statement;
  readonly upsertTrack: Database.Statement;
  readonly upsertScanError: Database.Statement;
  readonly clearSeenPaths: Database.Statement;
  readonly insertSeenPath: Database.Statement;
  readonly clearChangedPaths: Database.Statement;
  readonly insertChangedPath: Database.Statement;
  readonly listChangedPaths: Database.Statement;
  readonly clearDirectoryErrors: Database.Statement;
  readonly insertDirectoryError: Database.Statement;
  readonly countDirectoryErrors: Database.Statement;
  readonly deletePublishedDirectoryErrors: Database.Statement;
  readonly publishDirectoryErrors: Database.Statement;
  readonly markMissingFiles: Database.Statement;
  readonly finishLibraryRoot: Database.Statement;
}

export type ScanDiscoveryEntry =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly pathKey: string;
      readonly size: number;
      readonly modifiedMs: number;
    }
  | {
      readonly kind: "file-error";
      readonly path: string;
      readonly pathKey: string;
      readonly message: string;
    }
  | {
      readonly kind: "directory-error";
      readonly path: string;
      readonly pathKey: string;
      readonly message: string;
    };

export interface ScanDiscoveryBatchResult {
  readonly changed: number;
  readonly unchanged: number;
}

export interface PendingScanPath {
  readonly sequence: number;
  readonly path: string;
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

export interface StoredTagSnapshot {
  readonly id: string;
  readonly fileId: string;
  readonly path: string;
  readonly before: NormalizedTags;
  readonly after: NormalizedTags;
  readonly current: NormalizedTags;
  readonly scanState: "ok" | "error" | "missing";
  readonly verified: boolean;
  readonly error: string | null;
}

export class CatalogDatabase {
  readonly connection: Database.Database;
  private readonly scanStatements: ScanStatements;
  private readonly nextChangedSequence = new Map<string, number>();
  private catalogSearchDirty = false;

  constructor(
    path: string,
    options: { readonly interruptOrphanedJobs?: boolean } = {},
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new Database(path);
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("journal_mode = WAL");
    this.migrate();
    this.connection.exec(`
      CREATE TEMP TABLE scan_seen_paths (
        root_id TEXT NOT NULL,
        path_key TEXT NOT NULL,
        PRIMARY KEY (root_id, path_key)
      ) WITHOUT ROWID;
      CREATE TEMP TABLE scan_changed_paths (
        root_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (root_id, sequence)
      ) WITHOUT ROWID;
      CREATE TEMP TABLE scan_directory_errors_staging (
        root_id TEXT NOT NULL,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL,
        message TEXT NOT NULL,
        PRIMARY KEY (root_id, path_key)
      ) WITHOUT ROWID;
    `);
    this.scanStatements = {
      getFileByPathKey: this.connection.prepare(
        "SELECT * FROM audio_files WHERE path_key = ?",
      ),
      getAlbumByGroupingKey: this.connection.prepare(
        "SELECT id FROM albums WHERE grouping_key = ?",
      ),
      upsertAlbum: this.connection.prepare(
        `INSERT INTO albums (id, grouping_key, title, album_artist) VALUES (?, ?, ?, ?)
         ON CONFLICT(grouping_key) DO UPDATE SET title = excluded.title, album_artist = excluded.album_artist
         WHERE title IS NOT excluded.title OR album_artist IS NOT excluded.album_artist`,
      ),
      upsertAudioFile: this.connection.prepare(
        `INSERT INTO audio_files
         (id, root_id, path, path_key, size, modified_ms, signature, format, duration_seconds, normalized_tags_json, native_tags_json, scan_state, scan_error, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET path=excluded.path, path_key=excluded.path_key, size=excluded.size, modified_ms=excluded.modified_ms,
           signature=excluded.signature, format=excluded.format, duration_seconds=excluded.duration_seconds, normalized_tags_json=excluded.normalized_tags_json,
           native_tags_json=excluded.native_tags_json, scan_state='ok', scan_error=NULL, scanned_at=excluded.scanned_at`,
      ),
      upsertTrack: this.connection.prepare(
        `INSERT INTO tracks (id, file_id, album_id, title, track_number, disc_number) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_id) DO UPDATE SET album_id=excluded.album_id, title=excluded.title, track_number=excluded.track_number, disc_number=excluded.disc_number`,
      ),
      upsertScanError: this.connection.prepare(
        `INSERT INTO audio_files
         (id, root_id, path, path_key, size, modified_ms, signature, scan_state, scan_error, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'error', ?, ?)
         ON CONFLICT(id) DO UPDATE SET size=excluded.size, modified_ms=excluded.modified_ms, signature=excluded.signature,
           scan_state='error', scan_error=excluded.scan_error, scanned_at=excluded.scanned_at`,
      ),
      clearSeenPaths: this.connection.prepare(
        "DELETE FROM scan_seen_paths WHERE root_id = ?",
      ),
      insertSeenPath: this.connection.prepare(
        "INSERT OR IGNORE INTO scan_seen_paths (root_id, path_key) VALUES (?, ?)",
      ),
      clearChangedPaths: this.connection.prepare(
        "DELETE FROM scan_changed_paths WHERE root_id = ?",
      ),
      insertChangedPath: this.connection.prepare(
        "INSERT INTO scan_changed_paths (root_id, sequence, path) VALUES (?, ?, ?)",
      ),
      listChangedPaths: this.connection.prepare(
        `SELECT sequence, path FROM scan_changed_paths
         WHERE root_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`,
      ),
      clearDirectoryErrors: this.connection.prepare(
        "DELETE FROM scan_directory_errors_staging WHERE root_id = ?",
      ),
      insertDirectoryError: this.connection.prepare(
        `INSERT INTO scan_directory_errors_staging (root_id, path, path_key, message)
         VALUES (?, ?, ?, ?) ON CONFLICT(root_id, path_key) DO UPDATE SET path=excluded.path, message=excluded.message`,
      ),
      countDirectoryErrors: this.connection.prepare(
        "SELECT COUNT(*) FROM scan_directory_errors_staging WHERE root_id = ?",
      ),
      deletePublishedDirectoryErrors: this.connection.prepare(
        "DELETE FROM scan_directory_errors WHERE root_id = ?",
      ),
      publishDirectoryErrors: this.connection.prepare(
        `INSERT INTO scan_directory_errors (root_id, path, path_key, message, scanned_at)
         SELECT root_id, path, path_key, message, ? FROM scan_directory_errors_staging WHERE root_id = ?`,
      ),
      markMissingFiles: this.connection.prepare(
        `UPDATE audio_files SET scan_state='missing'
         WHERE root_id = ? AND NOT EXISTS (
           SELECT 1 FROM scan_seen_paths seen
           WHERE seen.root_id = ? AND seen.path_key = audio_files.path_key
         )`,
      ),
      finishLibraryRoot: this.connection.prepare(
        "UPDATE library_roots SET last_scan_at = ? WHERE id = ?",
      ),
    };
    if (options.interruptOrphanedJobs !== false) this.interruptOrphanedJobs();
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
    return this.scanStatements.getFileByPathKey.get(pathKey) as
      AudioFileRow | undefined;
  }

  upsertScannedFile(
    rootId: string,
    pathKey: string,
    file: ScannedAudioFile,
  ): string {
    const fileId = this.connection.transaction(() =>
      this.upsertScannedFileInTransaction(rootId, pathKey, file),
    )();
    this.catalogSearchDirty = true;
    return fileId;
  }

  upsertScannedFiles(
    rootId: string,
    files: readonly { pathKey: string; file: ScannedAudioFile }[],
  ): void {
    this.connection.transaction(() => {
      for (const entry of files)
        this.upsertScannedFileInTransaction(rootId, entry.pathKey, entry.file);
    })();
    if (files.length > 0) this.catalogSearchDirty = true;
  }

  private upsertScannedFileInTransaction(
    rootId: string,
    pathKey: string,
    file: ScannedAudioFile,
  ): string {
    const existing = this.getFileByPathKey(pathKey);
    const fileId = existing?.id ?? randomUUID();
    const signature = `${file.size}:${Math.trunc(file.modifiedMs)}`;
    const parentFolder = file.path.replace(/[\\/][^\\/]+$/u, "");
    const groupingKey = albumGroupingKey(file.tags, parentFolder);
    const album = this.scanStatements.getAlbumByGroupingKey.get(groupingKey) as
      { id: string } | undefined;
    const albumId = album?.id ?? randomUUID();
    const now = new Date().toISOString();
    this.scanStatements.upsertAlbum.run(
      albumId,
      groupingKey,
      file.tags.album,
      file.tags.albumArtist || file.tags.artist,
    );
    this.scanStatements.upsertAudioFile.run(
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
    this.scanStatements.upsertTrack.run(
      randomUUID(),
      fileId,
      albumId,
      file.tags.title,
      file.tags.trackNumber,
      file.tags.discNumber,
    );
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
    this.upsertScanErrorInTransaction(
      rootId,
      path,
      pathKey,
      size,
      modifiedMs,
      message,
    );
  }

  private upsertScanErrorInTransaction(
    rootId: string,
    path: string,
    pathKey: string,
    size: number,
    modifiedMs: number,
    message: string,
  ): void {
    this.catalogSearchDirty = true;
    const existing = this.getFileByPathKey(pathKey);
    this.scanStatements.upsertScanError.run(
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

  beginScan(rootId: string): void {
    this.connection.transaction(() => {
      this.scanStatements.clearSeenPaths.run(rootId);
      this.scanStatements.clearChangedPaths.run(rootId);
      this.scanStatements.clearDirectoryErrors.run(rootId);
    })();
    this.nextChangedSequence.set(rootId, 0);
  }

  recordScanDiscoveryBatch(
    rootId: string,
    entries: readonly ScanDiscoveryEntry[],
  ): ScanDiscoveryBatchResult {
    const firstSequence = this.nextChangedSequence.get(rootId);
    if (firstSequence === undefined)
      throw new Error("Scan discovery was not initialized.");
    let nextSequence = firstSequence;
    const result = this.connection.transaction(() => {
      let changed = 0;
      let unchanged = 0;
      for (const entry of entries) {
        if (entry.kind === "directory-error") {
          this.scanStatements.insertDirectoryError.run(
            rootId,
            entry.path,
            entry.pathKey,
            entry.message,
          );
          continue;
        }
        this.scanStatements.insertSeenPath.run(rootId, entry.pathKey);
        if (entry.kind === "file-error") {
          this.upsertScanErrorInTransaction(
            rootId,
            entry.path,
            entry.pathKey,
            0,
            0,
            entry.message,
          );
          continue;
        }
        const existing = this.getFileByPathKey(entry.pathKey);
        if (
          existing?.size === entry.size &&
          Math.trunc(existing.modified_ms) === Math.trunc(entry.modifiedMs)
        ) {
          unchanged++;
          continue;
        }
        this.scanStatements.insertChangedPath.run(
          rootId,
          nextSequence++,
          entry.path,
        );
        changed++;
      }
      return { changed, unchanged };
    })();
    this.nextChangedSequence.set(rootId, nextSequence);
    return result;
  }

  listChangedScanPaths(
    rootId: string,
    afterSequence: number,
    limit: number,
  ): readonly PendingScanPath[] {
    return this.scanStatements.listChangedPaths.all(
      rootId,
      afterSequence,
      limit,
    ) as PendingScanPath[];
  }

  recordScanDirectoryError(
    rootId: string,
    path: string,
    pathKey: string,
    message: string,
  ): void {
    this.scanStatements.insertDirectoryError.run(
      rootId,
      path,
      pathKey,
      message,
    );
  }

  finishScan(rootId: string): void {
    this.connection.transaction(() => {
      const directoryErrors = this.scanStatements.countDirectoryErrors
        .pluck()
        .get(rootId) as number;
      this.scanStatements.deletePublishedDirectoryErrors.run(rootId);
      this.scanStatements.publishDirectoryErrors.run(
        new Date().toISOString(),
        rootId,
      );
      if (directoryErrors === 0) {
        const missing = this.scanStatements.markMissingFiles.run(
          rootId,
          rootId,
        );
        if (missing.changes > 0) this.catalogSearchDirty = true;
      }
      this.scanStatements.finishLibraryRoot.run(
        new Date().toISOString(),
        rootId,
      );
      this.refreshCatalogSearchIfNeeded();
      this.scanStatements.clearSeenPaths.run(rootId);
      this.scanStatements.clearChangedPaths.run(rootId);
      this.scanStatements.clearDirectoryErrors.run(rootId);
    })();
    this.nextChangedSequence.delete(rootId);
  }

  abandonScan(rootId: string, recoverSearch = false): void {
    this.connection.transaction(() => {
      if (recoverSearch) this.rebuildCatalogSearch();
      else this.refreshCatalogSearchIfNeeded();
      this.scanStatements.clearSeenPaths.run(rootId);
      this.scanStatements.clearChangedPaths.run(rootId);
      this.scanStatements.clearDirectoryErrors.run(rootId);
    })();
    this.catalogSearchDirty = false;
    this.nextChangedSequence.delete(rootId);
  }

  listScanErrors(): readonly ScanErrorDto[] {
    return this.connection
      .prepare(
        `SELECT path, message, kind FROM (
           SELECT path, scan_error AS message, 'file' AS kind FROM audio_files WHERE scan_state = 'error'
           UNION ALL
           SELECT path, message, 'directory' AS kind FROM scan_directory_errors
         ) ORDER BY path, kind`,
      )
      .all() as ScanErrorDto[];
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
        ? ` WHERE (path LIKE ? ESCAPE '\\' COLLATE NOCASE OR message LIKE ? ESCAPE '\\' COLLATE NOCASE)`
        : "";
      const searchParameters = request.query ? [pattern, pattern] : [];
      const problems = `SELECT path, scan_error AS message, 'file' AS kind FROM audio_files WHERE scan_state='error'
        UNION ALL SELECT path, message, 'directory' AS kind FROM scan_directory_errors`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*) FROM (${problems}) problems${search}`)
        .pluck()
        .get(...searchParameters) as number;
      const scanErrors = this.connection
        .prepare(
          `SELECT path, message, kind FROM (${problems}) problems${search}
           ORDER BY path, kind LIMIT ? OFFSET ?`,
        )
        .all(
          ...searchParameters,
          request.limit,
          request.offset,
        ) as ScanErrorDto[];
      return {
        albums: [],
        scanErrors,
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (!request.query) {
      this.refreshCatalogSearchIfNeeded();
      const visibleAlbums = ` FROM catalog_visible_albums visible
        JOIN albums a ON a.id=visible.album_id`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*)${visibleAlbums}`)
        .pluck()
        .get() as number;
      const albumIds = this.connection
        .prepare(
          `SELECT a.id${visibleAlbums}
           ORDER BY a.album_artist, a.title, a.id LIMIT ? OFFSET ?`,
        )
        .all(request.limit, request.offset)
        .map((row) => (row as { id: string }).id);
      return {
        albums: this.listAlbumsByIds(albumIds),
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (Array.from(request.query).length >= 3) {
      this.refreshCatalogSearchIfNeeded();
      const match = `"${request.query.replaceAll('"', '""')}"`;
      const matchingAlbums = `SELECT a.id AS album_id FROM albums a
        JOIN catalog_visible_albums visible ON visible.album_id=a.id
        WHERE (a.title LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR a.album_artist LIKE ? ESCAPE '\\' COLLATE NOCASE)
        UNION
        SELECT d.album_id FROM catalog_search
        JOIN catalog_search_documents d ON d.id=catalog_search.rowid
        JOIN audio_files f ON f.id=d.file_id
        WHERE catalog_search MATCH ? AND f.scan_state='ok'`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*) FROM (${matchingAlbums})`)
        .pluck()
        .get(pattern, pattern, match) as number;
      const albumIds = this.connection
        .prepare(
          `SELECT a.id FROM albums a
           JOIN (${matchingAlbums}) matched ON matched.album_id=a.id
           ORDER BY a.album_artist, a.title, a.id LIMIT ? OFFSET ?`,
        )
        .all(pattern, pattern, match, request.limit, request.offset)
        .map((row) => (row as { id: string }).id);
      return {
        albums: this.listAlbumsByIds(albumIds),
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    const search = ` AND (a.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR a.album_artist LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR t.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR f.path LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR f.format LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR json_extract(f.normalized_tags_json, '$.artist') LIKE ? ESCAPE '\\' COLLATE NOCASE)`;
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
      f.*, t.id AS track_id FROM albums a
      CROSS JOIN tracks t ON t.album_id=a.id
      CROSS JOIN audio_files f ON f.id=t.file_id
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
    return this.listAlbumsByIds([id])[0];
  }

  getTrack(fileId: string): CatalogTrack | undefined {
    const row = this.connection
      .prepare("SELECT album_id FROM tracks WHERE file_id=?")
      .get(fileId) as { album_id: string } | undefined;
    return row
      ? this.listAlbumsByIds([row.album_id])[0]?.tracks.find(
          (track) => track.id === fileId,
        )
      : undefined;
  }

  getTrackAlbumId(fileId: string): string | undefined {
    return (
      this.connection
        .prepare("SELECT album_id FROM tracks WHERE file_id=?")
        .get(fileId) as { album_id: string } | undefined
    )?.album_id;
  }

  getFileEditState(fileId: string):
    | {
        path: string;
        tags: NormalizedTags;
        scanState: "ok" | "error" | "missing";
      }
    | undefined {
    const row = this.connection
      .prepare(
        "SELECT path, normalized_tags_json, scan_state FROM audio_files WHERE id=?",
      )
      .get(fileId) as
      | {
          path: string;
          normalized_tags_json: string | null;
          scan_state: "ok" | "error" | "missing";
        }
      | undefined;
    return row?.normalized_tags_json
      ? {
          path: row.path,
          tags: JSON.parse(row.normalized_tags_json) as NormalizedTags,
          scanState: row.scan_state,
        }
      : undefined;
  }

  createEditOperation(
    albumId: string,
    proposedTitle: string,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at, kind)
         VALUES (?, ?, ?, ?, 'previewed', ?, 'album-title-edit')`,
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

  createUndoOperation(
    albumId: string,
    sourceOperationId: string,
    proposedTitle: string,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at, kind, source_operation_id)
         VALUES (?, ?, ?, ?, 'previewed', ?, 'album-title-undo', ?)`,
      )
      .run(
        id,
        albumId,
        proposedTitle,
        confirmationHash,
        new Date().toISOString(),
        sourceOperationId,
      );
    return id;
  }

  createTrackEditOperation(
    albumId: string,
    fileId: string,
    before: NormalizedTags,
    changes: TrackTagChanges,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    const fields = Object.keys(changes).join(", ");
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at,
          kind, target_file_id, preview_tags_json, proposed_tags_json)
         VALUES (?, ?, ?, ?, 'previewed', ?, 'track-tags-edit', ?, ?, ?)`,
      )
      .run(
        id,
        albumId,
        `Track metadata: ${fields}`,
        confirmationHash,
        new Date().toISOString(),
        fileId,
        JSON.stringify(before),
        JSON.stringify(changes),
      );
    return id;
  }

  createTrackUndoOperation(
    albumId: string,
    sourceOperationId: string,
    fileId: string,
    current: NormalizedTags,
    changes: TrackTagChanges,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    const fields = Object.keys(changes).join(", ");
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at,
          kind, source_operation_id, target_file_id, preview_tags_json,
          proposed_tags_json)
         VALUES (?, ?, ?, ?, 'previewed', ?, 'track-tags-undo', ?, ?, ?, ?)`,
      )
      .run(
        id,
        albumId,
        `Restore track metadata: ${fields}`,
        confirmationHash,
        new Date().toISOString(),
        sourceOperationId,
        fileId,
        JSON.stringify(current),
        JSON.stringify(changes),
      );
    return id;
  }

  createTrackBatchEditOperation(
    albumId: string,
    previews: readonly { fileId: string; tags: NormalizedTags }[],
    changes: TrackTagChanges,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    const fields = Object.keys(changes).join(", ");
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at,
          kind, preview_tags_json, proposed_tags_json)
         VALUES (?, ?, ?, ?, 'previewed', ?, 'track-tags-batch-edit', ?, ?)`,
      )
      .run(
        id,
        albumId,
        `Batch metadata: ${fields}`,
        confirmationHash,
        new Date().toISOString(),
        JSON.stringify(previews),
        JSON.stringify(changes),
      );
    return id;
  }

  createTrackBatchUndoOperation(
    albumId: string,
    sourceOperationId: string,
    previews: readonly { fileId: string; tags: NormalizedTags }[],
    proposals: readonly { fileId: string; changes: TrackTagChanges }[],
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at,
          kind, source_operation_id, preview_tags_json, proposed_tags_json)
         VALUES (?, ?, 'Restore batch metadata', ?, 'previewed', ?,
          'track-tags-batch-undo', ?, ?, ?)`,
      )
      .run(
        id,
        albumId,
        confirmationHash,
        new Date().toISOString(),
        sourceOperationId,
        JSON.stringify(previews),
        JSON.stringify(proposals),
      );
    return id;
  }

  createTrackNumberSequenceOperation(
    albumId: string,
    previews: readonly { fileId: string; tags: NormalizedTags }[],
    proposals: readonly { fileId: string; changes: TrackTagChanges }[],
    startNumber: number,
    discNumber: number | undefined,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at,
          kind, preview_tags_json, proposed_tags_json)
         VALUES (?, ?, ?, ?, 'previewed', ?, 'track-number-sequence-edit', ?, ?)`,
      )
      .run(
        id,
        albumId,
        discNumber === undefined
          ? `Sequence track numbers from ${startNumber}`
          : `Sequence disc ${discNumber} track numbers from ${startNumber}`,
        confirmationHash,
        new Date().toISOString(),
        JSON.stringify(previews),
        JSON.stringify(proposals),
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
        kind:
          | "album-title-edit"
          | "album-title-undo"
          | "track-tags-edit"
          | "track-tags-undo"
          | "track-tags-batch-edit"
          | "track-tags-batch-undo"
          | "track-number-sequence-edit";
        source_operation_id: string | null;
        target_file_id: string | null;
        preview_tags_json: string | null;
        proposed_tags_json: string | null;
      }
    | undefined {
    return this.connection
      .prepare(
        `SELECT id, album_id, proposed_title, confirmation_hash, state, kind,
          source_operation_id, target_file_id, preview_tags_json,
          proposed_tags_json FROM edit_operations WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          album_id: string;
          proposed_title: string;
          confirmation_hash: string;
          state: string;
          kind:
            | "album-title-edit"
            | "album-title-undo"
            | "track-tags-edit"
            | "track-tags-undo"
            | "track-tags-batch-edit"
            | "track-tags-batch-undo"
            | "track-number-sequence-edit";
          source_operation_id: string | null;
          target_file_id: string | null;
          preview_tags_json: string | null;
          proposed_tags_json: string | null;
        }
      | undefined;
  }

  listEditHistory(albumId: string): readonly TagEditHistoryItemDto[] {
    const rows = this.connection
      .prepare(
        `SELECT operation.id, operation.kind, operation.source_operation_id,
          operation.proposed_title, operation.state, operation.created_at,
          operation.completed_at,
          COALESCE(SUM(CASE WHEN snapshot.verified=1 THEN 1 ELSE 0 END), 0) AS verified_files,
          COALESCE(SUM(CASE WHEN snapshot.id IS NOT NULL AND snapshot.verified=0 THEN 1 ELSE 0 END), 0) AS failed_files
         FROM edit_operations operation
         LEFT JOIN tag_snapshots snapshot ON snapshot.operation_id=operation.id
         WHERE operation.state IN ('completed', 'failed') AND
           (operation.album_id=? OR EXISTS (
             SELECT 1 FROM tag_snapshots current_snapshot
             JOIN tracks current_track ON current_track.file_id=current_snapshot.file_id
             WHERE current_snapshot.operation_id=operation.id AND current_track.album_id=?
           ))
         GROUP BY operation.id
         ORDER BY operation.created_at DESC, operation.id DESC
         LIMIT 50`,
      )
      .all(albumId, albumId) as {
      id: string;
      kind:
        | "album-title-edit"
        | "album-title-undo"
        | "track-tags-edit"
        | "track-tags-undo"
        | "track-tags-batch-edit"
        | "track-tags-batch-undo"
        | "track-number-sequence-edit";
      source_operation_id: string | null;
      proposed_title: string;
      state: "completed" | "failed";
      created_at: string;
      completed_at: string | null;
      verified_files: number;
      failed_files: number;
    }[];
    return rows.map((row) => ({
      operationId: row.id,
      kind: row.kind,
      sourceOperationId: row.source_operation_id,
      proposedTitle: row.proposed_title,
      state: row.state,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      verifiedFiles: row.verified_files,
      failedFiles: row.failed_files,
    }));
  }

  listSnapshots(operationId: string): readonly StoredTagSnapshot[] {
    const rows = this.connection
      .prepare(
        `SELECT snapshot.id, snapshot.file_id, snapshot.before_tags_json,
          snapshot.after_tags_json, snapshot.verified, snapshot.error,
          file.path, file.normalized_tags_json, file.scan_state
         FROM tag_snapshots snapshot
         JOIN audio_files file ON file.id=snapshot.file_id
         WHERE snapshot.operation_id=? ORDER BY snapshot.id`,
      )
      .all(operationId) as {
      id: string;
      file_id: string;
      before_tags_json: string;
      after_tags_json: string;
      path: string;
      normalized_tags_json: string | null;
      scan_state: "ok" | "error" | "missing";
      verified: number;
      error: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      path: row.path,
      before: JSON.parse(row.before_tags_json) as NormalizedTags,
      after: JSON.parse(row.after_tags_json) as NormalizedTags,
      current: JSON.parse(row.normalized_tags_json ?? "{}") as NormalizedTags,
      scanState: row.scan_state,
      verified: row.verified === 1,
      error: row.error,
    }));
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
    this.refreshCatalogSearchIfNeeded();
  }

  updateFileAfterEdit(fileId: string, file: ScannedAudioFile): void {
    const row = this.connection
      .prepare("SELECT root_id, path_key FROM audio_files WHERE id=?")
      .get(fileId) as { root_id: string; path_key: string };
    this.upsertScannedFile(row.root_id, row.path_key, file);
  }

  private refreshCatalogSearchIfNeeded(): void {
    if (!this.catalogSearchDirty) return;
    this.rebuildCatalogSearch();
    this.catalogSearchDirty = false;
  }

  private rebuildCatalogSearch(): void {
    this.connection.exec(`
      DELETE FROM catalog_search_documents;
      INSERT INTO catalog_search_documents
        (file_id, album_id, track_title, track_artist, file_path, format)
      SELECT f.id, t.album_id, t.title,
        COALESCE(json_extract(f.normalized_tags_json, '$.artist'), ''),
        f.path, COALESCE(f.format, '')
      FROM tracks t
      JOIN audio_files f ON f.id=t.file_id;
      INSERT INTO catalog_search(catalog_search) VALUES ('rebuild');
      DELETE FROM catalog_visible_albums;
      INSERT INTO catalog_visible_albums(album_id)
      SELECT DISTINCT t.album_id FROM tracks t
      JOIN audio_files f ON f.id=t.file_id
      WHERE f.scan_state='ok';
    `);
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
