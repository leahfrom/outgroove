import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import {
  createSavedLibraryFilterRequestSchema,
  savedLibraryFilterDefinitionSchema,
  updateSavedLibraryFilterRequestSchema,
  type SavedLibraryFilterDefinition,
  type SavedLibraryFilterDto,
  type LibraryFormatDto,
  type LibraryFolderDto,
  type LibraryGenreDto,
  type LibraryPageDto,
  type LibraryTrackDto,
  type LibraryRootDto,
  type LibraryRootRemovalPreviewDto,
  type LibraryRootRemovalResultDto,
  type ScanErrorDto,
  type ScanJobDto,
  type ScanJobState,
  type ScanResultDto,
  type SyncHistoryItemDto,
  type SyncProfileDto,
  type TagEditHistoryItemDto,
} from "../../../shared/contracts/api";
import type {
  CatalogAlbum,
  CatalogTrack,
  NormalizedTags,
  ScannedAudioFile,
} from "../../../shared/domain/catalog";
import {
  albumGroupingKey,
  compareAlbumsByArtistReleaseDateTitle,
  folderAlbumGroupingKey,
  sortTracks,
} from "../../../shared/domain/catalog";
import { isValidPartialDate } from "../../../shared/domain/partial-date";
import type { TrackTagChanges } from "../../../shared/domain/tag-edit";
import { migrations } from "./migrations";

const albumReleaseDatesJoin = `
  LEFT JOIN (
    SELECT album_id,
      CASE
        WHEN COUNT(*) = COUNT(release_date)
          AND COUNT(DISTINCT release_date) = 1
        THEN MIN(release_date)
        ELSE NULL
      END AS release_date
    FROM (
      SELECT release_track.album_id,
        CASE
          WHEN outgroove_valid_partial_date(
            NULLIF(TRIM(CAST(json_extract(
              release_file.normalized_tags_json, '$.year'
            ) AS TEXT)), '')
          ) = 1
          THEN NULLIF(TRIM(CAST(json_extract(
            release_file.normalized_tags_json, '$.year'
          ) AS TEXT)), '')
          ELSE NULL
        END AS release_date
      FROM tracks release_track
      JOIN audio_files release_file ON release_file.id=release_track.file_id
      WHERE release_file.scan_state='ok'
    ) release_values
    GROUP BY album_id
  ) album_release ON album_release.album_id=a.id`;

const albumLibraryOrder = `a.album_artist COLLATE NOCASE, a.album_artist,
  album_release.release_date IS NULL, album_release.release_date,
  a.title COLLATE NOCASE, a.title, a.id`;

interface AudioFileRow {
  id: string;
  root_id: string;
  path: string;
  size: number;
  modified_ms: number;
  signature: string;
  format: string | null;
  duration_seconds: number | null;
  codec: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  technical_properties_version: number;
  normalized_tags_json: string | null;
  native_tags_json: string | null;
  scan_state: "ok" | "error" | "missing";
  scan_error: string | null;
  genres_type?: string | null;
  composers_type?: string | null;
  conductors_type?: string | null;
  lyricists_type?: string | null;
  isrcs_type?: string | null;
  copyright_type?: string | null;
  comments_type?: string | null;
  comment_type?: string | null;
  original_release_date_type?: string | null;
  language_type?: string | null;
  track_total_type?: string | null;
  disc_total_type?: string | null;
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

export interface SyncRunChangeRecord {
  readonly id: string;
  readonly sequence: number;
  readonly kind: "copy" | "playlist" | "manifest";
  readonly relativeDestination: string;
  readonly temporaryRelative: string;
  readonly rollbackRelative: string | null;
  readonly expectedHash: string;
  readonly installed: boolean;
}

export interface SyncRunRecord {
  readonly id: string;
  readonly planId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly targetPath: string;
  readonly phase: "copying" | "finalizing";
  readonly state: "applying" | "recovery-required" | "committed-cleanup";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly changes: readonly SyncRunChangeRecord[];
}

interface ScanStatements {
  readonly getFileByPathKey: Database.Statement;
  readonly restoreUnchangedFile: Database.Statement;
  readonly getAlbumByGroupingKey: Database.Statement;
  readonly getAlbumByFolderKey: Database.Statement;
  readonly insertAlbum: Database.Statement;
  readonly insertAlbumGroupingAlias: Database.Statement;
  readonly insertAlbumFolderAlias: Database.Statement;
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

function parentFolderKey(pathKey: string): string {
  const parent = pathKey.replace(/[\\/][^\\/]+$/u, "");
  return parent === "" && pathKey.startsWith("/") ? "/" : parent;
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

export interface StoredArtworkPicture {
  readonly mimeType: string;
  readonly kind: number;
  readonly description?: string;
  readonly data: Uint8Array;
}

export interface StoredArtworkSnapshot extends StoredTagSnapshot {
  readonly beforePictures: readonly StoredArtworkPicture[];
  readonly afterPictures: readonly StoredArtworkPicture[];
}

function hydrateRebuildableTotals(tags: NormalizedTags): NormalizedTags {
  return {
    ...tags,
    trackTotal: tags.trackTotal ?? null,
    discTotal: tags.discTotal ?? null,
  };
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
    this.connection.function(
      "outgroove_parent_folder_key",
      { deterministic: true },
      (value) => parentFolderKey(String(value)),
    );
    this.connection.function(
      "outgroove_parent_folder_path",
      { deterministic: true },
      (value) => dirname(String(value)),
    );
    this.connection.function(
      "outgroove_valid_partial_date",
      { deterministic: true },
      (value) =>
        typeof value === "string" && isValidPartialDate(value) ? 1 : 0,
    );
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
      CREATE TEMP TABLE catalog_file_folders (
        file_id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        path TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX catalog_file_folders_by_folder
        ON catalog_file_folders(folder_id, file_id);
      CREATE TEMP TABLE catalog_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        album_count INTEGER NOT NULL,
        track_count INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX catalog_folders_by_path
        ON catalog_folders(path COLLATE NOCASE, path);
    `);
    this.scanStatements = {
      getFileByPathKey: this.connection.prepare(
        `SELECT *,
           json_type(normalized_tags_json, '$.genres') AS genres_type,
           json_type(normalized_tags_json, '$.composers') AS composers_type,
           json_type(normalized_tags_json, '$.conductors') AS conductors_type,
           json_type(normalized_tags_json, '$.lyricists') AS lyricists_type,
           json_type(normalized_tags_json, '$.isrcs') AS isrcs_type,
           json_type(normalized_tags_json, '$.copyright') AS copyright_type,
           json_type(normalized_tags_json, '$.comments') AS comments_type,
           json_type(normalized_tags_json, '$.comment') AS comment_type,
           json_type(normalized_tags_json, '$.originalReleaseDate') AS original_release_date_type,
           json_type(normalized_tags_json, '$.language') AS language_type,
           json_type(normalized_tags_json, '$.trackTotal') AS track_total_type,
           json_type(normalized_tags_json, '$.discTotal') AS disc_total_type
         FROM audio_files WHERE path_key = ?`,
      ),
      restoreUnchangedFile: this.connection.prepare(
        `UPDATE audio_files SET scan_state='ok', scan_error=NULL, scanned_at=?
         WHERE id=? AND root_id=? AND scan_state='missing'`,
      ),
      getAlbumByGroupingKey: this.connection.prepare(
        `SELECT album_id AS id FROM album_grouping_aliases
         WHERE grouping_key = ?`,
      ),
      getAlbumByFolderKey: this.connection.prepare(
        `SELECT album_id AS id FROM album_folder_aliases
         WHERE folder_album_key = ?`,
      ),
      insertAlbum: this.connection.prepare(
        `INSERT INTO albums (id, grouping_key, title, album_artist)
         VALUES (?, ?, ?, ?)`,
      ),
      insertAlbumGroupingAlias: this.connection.prepare(
        `INSERT OR IGNORE INTO album_grouping_aliases
         (grouping_key, album_id) VALUES (?, ?)`,
      ),
      insertAlbumFolderAlias: this.connection.prepare(
        `INSERT OR IGNORE INTO album_folder_aliases
         (folder_album_key, album_id) VALUES (?, ?)`,
      ),
      upsertAudioFile: this.connection.prepare(
        `INSERT INTO audio_files
         (id, root_id, path, path_key, size, modified_ms, signature, format,
          duration_seconds, codec, bitrate, sample_rate, bit_depth, channels,
          technical_properties_version, normalized_tags_json, native_tags_json,
          scan_state, scan_error, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ok', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET path=excluded.path, path_key=excluded.path_key, size=excluded.size, modified_ms=excluded.modified_ms,
           signature=excluded.signature, format=excluded.format, duration_seconds=excluded.duration_seconds,
           codec=excluded.codec, bitrate=excluded.bitrate, sample_rate=excluded.sample_rate,
           bit_depth=excluded.bit_depth, channels=excluded.channels,
           technical_properties_version=excluded.technical_properties_version,
           normalized_tags_json=excluded.normalized_tags_json,
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
    this.reconcileAlbumGroupingAliases();
    this.rebuildFolderCatalog();
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

  private reconcileAlbumGroupingAliases(): void {
    const state = this.connection
      .prepare(
        `SELECT value FROM catalog_metadata
         WHERE key='album-grouping-reconciliation'`,
      )
      .pluck()
      .get() as string | undefined;
    if (state !== "pending") return;

    const rows = this.connection
      .prepare(
        `SELECT a.id AS album_id, a.title, f.path_key
         FROM albums a
         JOIN tracks t ON t.album_id=a.id
         JOIN audio_files f ON f.id=t.file_id
         ORDER BY a.id, f.path_key`,
      )
      .all() as { album_id: string; title: string; path_key: string }[];
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      const current = parent.get(id) ?? id;
      if (current === id) return id;
      const root = find(current);
      parent.set(id, root);
      return root;
    };
    const union = (left: string, right: string): void => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) return;
      if (leftRoot < rightRoot) parent.set(rightRoot, leftRoot);
      else parent.set(leftRoot, rightRoot);
    };
    const albumByFolder = new Map<string, string>();
    for (const row of rows) {
      parent.set(row.album_id, parent.get(row.album_id) ?? row.album_id);
      const folderKey = folderAlbumGroupingKey(
        row.title,
        parentFolderKey(row.path_key),
      );
      const existing = albumByFolder.get(folderKey);
      if (existing) union(existing, row.album_id);
      else albumByFolder.set(folderKey, row.album_id);
    }
    const components = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      const component = components.get(root) ?? [];
      component.push(id);
      components.set(root, component);
    }

    this.connection.transaction(() => {
      for (const component of components.values()) {
        if (component.length < 2) continue;
        const [canonical, ...duplicates] = component.sort();
        if (!canonical) continue;
        for (const duplicate of duplicates) {
          this.connection
            .prepare("UPDATE tracks SET album_id=? WHERE album_id=?")
            .run(canonical, duplicate);
          this.connection
            .prepare("UPDATE edit_operations SET album_id=? WHERE album_id=?")
            .run(canonical, duplicate);
          this.connection
            .prepare("UPDATE sync_profiles SET album_id=? WHERE album_id=?")
            .run(canonical, duplicate);
          this.connection
            .prepare(
              `INSERT OR IGNORE INTO sync_profile_albums (profile_id, album_id)
               SELECT profile_id, ? FROM sync_profile_albums WHERE album_id=?`,
            )
            .run(canonical, duplicate);
          this.connection
            .prepare("DELETE FROM sync_profile_albums WHERE album_id=?")
            .run(duplicate);
          this.connection
            .prepare(
              "UPDATE album_grouping_aliases SET album_id=? WHERE album_id=?",
            )
            .run(canonical, duplicate);
          this.connection
            .prepare(
              "UPDATE album_folder_aliases SET album_id=? WHERE album_id=?",
            )
            .run(canonical, duplicate);
          this.connection
            .prepare("DELETE FROM albums WHERE id=?")
            .run(duplicate);
        }
      }
      for (const row of rows)
        this.connection
          .prepare(
            `INSERT OR IGNORE INTO album_folder_aliases
             (folder_album_key, album_id) VALUES (?, ?)`,
          )
          .run(
            folderAlbumGroupingKey(row.title, parentFolderKey(row.path_key)),
            find(row.album_id),
          );
      this.rebuildCatalogSearch();
      this.connection
        .prepare(
          `UPDATE catalog_metadata SET value='complete'
           WHERE key='album-grouping-reconciliation'`,
        )
        .run();
    })();
    this.catalogSearchDirty = false;
  }

  private interruptOrphanedJobs(): void {
    const now = new Date().toISOString();
    this.connection.transaction(() => {
      this.connection
        .prepare(
          `UPDATE jobs SET state='interrupted', error='Outgroove closed before this scan finished.', updated_at=?, finished_at=?
           WHERE state IN ('queued', 'running', 'cancelling')`,
        )
        .run(now, now);
      this.connection
        .prepare(
          `UPDATE sync_runs SET state='recovery-required', updated_at=?
           WHERE state='applying'`,
        )
        .run(now);
    })();
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
    if (existing) {
      this.connection
        .prepare("UPDATE library_roots SET path=?, removed_at=NULL WHERE id=?")
        .run(path, existing.id);
      return {
        id: existing.id,
        path,
        lastScanAt: existing.last_scan_at,
      };
    }
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
      .prepare(
        "SELECT id, path FROM library_roots WHERE id = ? AND removed_at IS NULL",
      )
      .get(id) as { id: string; path: string } | undefined;
  }

  listLibraryRoots(): readonly LibraryRootDto[] {
    return this.connection
      .prepare(
        `SELECT id, path, last_scan_at AS lastScanAt FROM library_roots
         WHERE removed_at IS NULL ORDER BY created_at`,
      )
      .all() as LibraryRootDto[];
  }

  listSavedLibraryFilters(): readonly SavedLibraryFilterDto[] {
    const rows = this.connection
      .prepare(
        `SELECT id, name, definition_version, definition_json, created_at
         FROM saved_library_filters
         ORDER BY name COLLATE NOCASE, name, id
         LIMIT 100`,
      )
      .all() as {
      id: string;
      name: string;
      definition_version: number;
      definition_json: string;
      created_at: string;
    }[];
    return rows.map((row) => {
      if (row.definition_version !== 1)
        throw new Error(
          `Saved Library filter “${row.name}” uses an unsupported definition version.`,
        );
      return {
        id: row.id,
        name: row.name,
        definition: savedLibraryFilterDefinitionSchema.parse(
          JSON.parse(row.definition_json),
        ),
        createdAt: row.created_at,
      };
    });
  }

  createSavedLibraryFilter(
    name: string,
    definition: SavedLibraryFilterDefinition,
  ): SavedLibraryFilterDto {
    const parsed = createSavedLibraryFilterRequestSchema.parse({
      name,
      definition,
    });
    const duplicate = this.connection
      .prepare(
        "SELECT 1 FROM saved_library_filters WHERE name=? COLLATE NOCASE",
      )
      .get(parsed.name);
    if (duplicate)
      throw new Error(
        `A saved Library filter named “${parsed.name}” already exists.`,
      );
    const count = this.connection
      .prepare("SELECT COUNT(*) FROM saved_library_filters")
      .pluck()
      .get() as number;
    if (count >= 100)
      throw new Error("Outgroove supports up to 100 saved Library filters.");
    const saved: SavedLibraryFilterDto = {
      id: randomUUID(),
      name: parsed.name,
      definition: parsed.definition,
      createdAt: new Date().toISOString(),
    };
    this.connection
      .prepare(
        `INSERT INTO saved_library_filters
         (id, name, definition_version, definition_json, created_at)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .run(
        saved.id,
        saved.name,
        JSON.stringify(saved.definition),
        saved.createdAt,
      );
    return saved;
  }

  updateSavedLibraryFilter(
    id: string,
    name: string,
    definition: SavedLibraryFilterDefinition,
  ): SavedLibraryFilterDto {
    const parsed = updateSavedLibraryFilterRequestSchema.parse({
      id,
      name,
      definition,
    });
    const existing = this.connection
      .prepare("SELECT created_at FROM saved_library_filters WHERE id=?")
      .get(parsed.id) as { created_at: string } | undefined;
    if (!existing)
      throw new Error("The saved Library filter no longer exists.");
    const duplicate = this.connection
      .prepare(
        "SELECT 1 FROM saved_library_filters WHERE name=? COLLATE NOCASE AND id<>?",
      )
      .get(parsed.name, parsed.id);
    if (duplicate)
      throw new Error(
        `A saved Library filter named “${parsed.name}” already exists.`,
      );
    this.connection
      .prepare(
        `UPDATE saved_library_filters
         SET name=?, definition_version=1, definition_json=? WHERE id=?`,
      )
      .run(parsed.name, JSON.stringify(parsed.definition), parsed.id);
    return {
      id: parsed.id,
      name: parsed.name,
      definition: parsed.definition,
      createdAt: existing.created_at,
    };
  }

  deleteSavedLibraryFilter(id: string): { id: string } {
    const result = this.connection
      .prepare("DELETE FROM saved_library_filters WHERE id=?")
      .run(id);
    if (result.changes !== 1)
      throw new Error("The saved Library filter no longer exists.");
    return { id };
  }

  getLibraryRootRemovalImpact(
    rootId: string,
  ):
    | Omit<LibraryRootRemovalPreviewDto, "operationId" | "confirmationToken">
    | undefined {
    const root = this.getLibraryRoot(rootId);
    if (!root) return undefined;
    const visibleTracks = this.connection
      .prepare(
        `SELECT COUNT(*) FROM tracks t JOIN audio_files f ON f.id=t.file_id
         WHERE f.root_id=? AND f.scan_state='ok'`,
      )
      .pluck()
      .get(rootId) as number;
    const albumsHidden = this.connection
      .prepare(
        `SELECT COUNT(*) FROM (
           SELECT DISTINCT current_track.album_id
           FROM tracks current_track
           JOIN audio_files current_file ON current_file.id=current_track.file_id
           WHERE current_file.root_id=? AND current_file.scan_state='ok'
             AND NOT EXISTS (
               SELECT 1 FROM tracks other_track
               JOIN audio_files other_file ON other_file.id=other_track.file_id
               WHERE other_track.album_id=current_track.album_id
                 AND other_file.root_id<>? AND other_file.scan_state='ok'
             )
         )`,
      )
      .pluck()
      .get(rootId, rootId) as number;
    const fileProblems = this.connection
      .prepare(
        "SELECT COUNT(*) FROM audio_files WHERE root_id=? AND scan_state='error'",
      )
      .pluck()
      .get(rootId) as number;
    const directoryProblems = this.connection
      .prepare("SELECT COUNT(*) FROM scan_directory_errors WHERE root_id=?")
      .pluck()
      .get(rootId) as number;
    return {
      rootId,
      path: root.path,
      visibleTracks,
      albumsHidden,
      scanProblemsHidden: fileProblems + directoryProblems,
    };
  }

  stopWatchingLibraryRoot(rootId: string): LibraryRootRemovalResultDto {
    return this.connection.transaction(() => {
      const impact = this.getLibraryRootRemovalImpact(rootId);
      if (!impact) throw new Error("Watched Library folder does not exist.");
      if (this.getActiveScanJob(rootId))
        throw new Error("Cancel this folder's active scan before removing it.");
      this.connection
        .prepare(
          "UPDATE library_roots SET removed_at=? WHERE id=? AND removed_at IS NULL",
        )
        .run(new Date().toISOString(), rootId);
      this.connection
        .prepare("UPDATE audio_files SET scan_state='missing' WHERE root_id=?")
        .run(rootId);
      this.connection
        .prepare("DELETE FROM scan_directory_errors WHERE root_id=?")
        .run(rootId);
      this.rebuildCatalogSearch();
      this.catalogSearchDirty = false;
      return {
        rootId,
        visibleTracksHidden: impact.visibleTracks,
        albumsHidden: impact.albumsHidden,
        scanProblemsHidden: impact.scanProblemsHidden,
        audioFilesDeleted: 0 as const,
      };
    })();
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
        `SELECT job.* FROM jobs job
         JOIN library_roots root ON root.id=job.root_id
         WHERE job.type='scan' AND root.removed_at IS NULL
         ORDER BY job.created_at DESC LIMIT 1`,
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
    preferredAlbumId?: string,
  ): string {
    const existing = this.getFileByPathKey(pathKey);
    const fileId = existing?.id ?? randomUUID();
    const signature = `${file.size}:${Math.trunc(file.modifiedMs)}`;
    const parentFolder = file.path.replace(/[\\/][^\\/]+$/u, "");
    const groupingKey = albumGroupingKey(file.tags, parentFolder);
    const folderKey = folderAlbumGroupingKey(
      file.tags.album,
      parentFolderKey(pathKey),
    );
    const folderAlbum = this.scanStatements.getAlbumByFolderKey.get(
      folderKey,
    ) as { id: string } | undefined;
    const groupedAlbum = this.scanStatements.getAlbumByGroupingKey.get(
      groupingKey,
    ) as { id: string } | undefined;
    const albumId = preferredAlbumId ?? folderAlbum?.id ?? groupedAlbum?.id;
    const targetAlbumId = albumId ?? randomUUID();
    const now = new Date().toISOString();
    if (!albumId)
      this.scanStatements.insertAlbum.run(
        targetAlbumId,
        groupingKey,
        file.tags.album,
        file.tags.albumArtist || file.tags.artist,
      );
    this.scanStatements.insertAlbumGroupingAlias.run(
      groupingKey,
      targetAlbumId,
    );
    this.scanStatements.insertAlbumFolderAlias.run(folderKey, targetAlbumId);
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
      file.codec ?? null,
      file.bitrate ?? null,
      file.sampleRate ?? null,
      file.bitDepth ?? null,
      file.channels ?? null,
      JSON.stringify({
        ...file.tags,
        trackTotal: file.tags.trackTotal ?? null,
        discTotal: file.tags.discTotal ?? null,
        genres: file.tags.genres ?? [],
        composers: file.tags.composers ?? [],
        conductors: file.tags.conductors ?? [],
        lyricists: file.tags.lyricists ?? [],
        isrcs: file.tags.isrcs ?? [],
        copyright: file.tags.copyright ?? null,
        comment: file.tags.comment ?? null,
        comments: file.tags.comments ?? [],
        originalReleaseDate: file.tags.originalReleaseDate ?? null,
        language: file.tags.language ?? null,
      }),
      JSON.stringify(file.nativeTags),
      now,
    );
    this.scanStatements.upsertTrack.run(
      randomUUID(),
      fileId,
      targetAlbumId,
      file.tags.title,
      file.tags.trackNumber,
      file.tags.discNumber,
    );
    this.connection
      .prepare("UPDATE albums SET title=? WHERE id=?")
      .run(file.tags.album, targetAlbumId);
    const albumArtists = this.connection
      .prepare(
        `SELECT DISTINCT json_extract(f.normalized_tags_json, '$.albumArtist') AS album_artist
         FROM tracks t JOIN audio_files f ON f.id=t.file_id
         WHERE t.album_id=? AND f.scan_state='ok'
         ORDER BY album_artist`,
      )
      .pluck()
      .all(targetAlbumId) as string[];
    if (albumArtists.length === 1 && albumArtists[0])
      this.connection
        .prepare("UPDATE albums SET album_artist=? WHERE id=?")
        .run(albumArtists[0], targetAlbumId);
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
          Math.trunc(existing.modified_ms) === Math.trunc(entry.modifiedMs) &&
          (existing.scan_state === "error" ||
            (existing.genres_type === "array" &&
              existing.composers_type === "array" &&
              existing.conductors_type === "array" &&
              existing.lyricists_type === "array" &&
              existing.isrcs_type === "array" &&
              (existing.copyright_type === "text" ||
                existing.copyright_type === "null") &&
              existing.comments_type === "array" &&
              (existing.comment_type === "text" ||
                existing.comment_type === "null") &&
              (existing.original_release_date_type === "text" ||
                existing.original_release_date_type === "null") &&
              (existing.language_type === "text" ||
                existing.language_type === "null") &&
              (existing.track_total_type === "integer" ||
                existing.track_total_type === "null") &&
              (existing.disc_total_type === "integer" ||
                existing.disc_total_type === "null") &&
              existing.technical_properties_version >= 1))
        ) {
          const restored = this.scanStatements.restoreUnchangedFile.run(
            new Date().toISOString(),
            existing.id,
            rootId,
          );
          if (restored.changes > 0) this.catalogSearchDirty = true;
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
    view:
      | "albums"
      | "artists"
      | "genres"
      | "formats"
      | "folders"
      | "tracks"
      | "scan-errors";
    offset: number;
    limit: number;
    albumArtist?: string;
    albumId?: string;
    format?: string;
    folderId?: string;
    genre?: string;
    missingGenre?: true;
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
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors,
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (request.view === "folders") {
      this.refreshCatalogSearchIfNeeded();
      const search = request.query
        ? ` WHERE path LIKE ? ESCAPE '\\' COLLATE NOCASE`
        : "";
      const searchParameters = request.query ? [pattern] : [];
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*) FROM catalog_folders${search}`)
        .pluck()
        .get(...searchParameters) as number;
      const folders = this.connection
        .prepare(
          `SELECT id, path, album_count AS albumCount,
            track_count AS trackCount
           FROM catalog_folders${search}
           ORDER BY path COLLATE NOCASE, path, id LIMIT ? OFFSET ?`,
        )
        .all(
          ...searchParameters,
          request.limit,
          request.offset,
        ) as LibraryFolderDto[];
      return {
        albums: [],
        artists: [],
        formats: [],
        folders,
        tracks: [],
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (request.view === "formats") {
      const normalizedFormat =
        "COALESCE(NULLIF(TRIM(f.format), ''), 'unknown')";
      const search = request.query
        ? ` AND ${normalizedFormat} LIKE ? ESCAPE '\\' COLLATE NOCASE`
        : "";
      const searchParameters = request.query ? [pattern] : [];
      const visibleFormats = ` FROM audio_files f
        JOIN tracks t ON t.file_id=f.id
        WHERE f.scan_state='ok'${search}
        GROUP BY ${normalizedFormat} COLLATE NOCASE`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*) FROM (SELECT 1${visibleFormats})`)
        .pluck()
        .get(...searchParameters) as number;
      const formats = this.connection
        .prepare(
          `SELECT MIN(${normalizedFormat}) AS name,
            COUNT(DISTINCT f.id) AS trackCount
           ${visibleFormats}
           ORDER BY name COLLATE NOCASE, name LIMIT ? OFFSET ?`,
        )
        .all(
          ...searchParameters,
          request.limit,
          request.offset,
        ) as LibraryFormatDto[];
      return {
        albums: [],
        artists: [],
        formats,
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (request.view === "genres") {
      const genreArray =
        "CASE WHEN json_type(f.normalized_tags_json, '$.genres') = 'array' THEN json_extract(f.normalized_tags_json, '$.genres') ELSE json('[]') END";
      const normalizedGenre = "NULLIF(TRIM(CAST(genre.value AS TEXT)), '')";
      const search = request.query
        ? ` AND COALESCE(${normalizedGenre}, 'No genre tag') LIKE ? ESCAPE '\\' COLLATE NOCASE`
        : "";
      const searchParameters = request.query ? [pattern] : [];
      const visibleGenres = ` FROM audio_files f
        JOIN tracks t ON t.file_id=f.id
        LEFT JOIN json_each(${genreArray}) genre ON TRUE
        WHERE f.scan_state='ok'${search}
        GROUP BY (${normalizedGenre} IS NULL), ${normalizedGenre} COLLATE NOCASE`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*) FROM (SELECT 1${visibleGenres})`)
        .pluck()
        .get(...searchParameters) as number;
      const rows = this.connection
        .prepare(
          `SELECT COALESCE(MIN(${normalizedGenre}), 'No genre tag') AS name,
            COUNT(DISTINCT f.id) AS trackCount,
            (${normalizedGenre} IS NULL) AS missing
           ${visibleGenres}
           ORDER BY missing, name COLLATE NOCASE, name LIMIT ? OFFSET ?`,
        )
        .all(...searchParameters, request.limit, request.offset) as {
        name: string;
        trackCount: number;
        missing: number;
      }[];
      const genres: LibraryGenreDto[] = rows.map((row) => ({
        ...row,
        missing: row.missing === 1,
      }));
      return {
        albums: [],
        artists: [],
        genres,
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (request.view === "tracks") {
      if (request.folderId) this.refreshCatalogSearchIfNeeded();
      const formatFilter = request.format
        ? ` AND COALESCE(NULLIF(TRIM(f.format), ''), 'unknown') = ? COLLATE NOCASE`
        : "";
      const formatParameters = request.format ? [request.format] : [];
      const folderFilter = request.folderId ? ` AND folder.folder_id = ?` : "";
      const folderParameters = request.folderId ? [request.folderId] : [];
      const genreFilter = request.genre
        ? ` AND EXISTS (
          SELECT 1 FROM json_each(CASE
            WHEN json_type(f.normalized_tags_json, '$.genres') = 'array'
            THEN json_extract(f.normalized_tags_json, '$.genres') ELSE json('[]') END) selected_genre
          WHERE NULLIF(TRIM(CAST(selected_genre.value AS TEXT)), '') = ? COLLATE NOCASE)`
        : request.missingGenre
          ? ` AND NOT EXISTS (
            SELECT 1 FROM json_each(CASE
              WHEN json_type(f.normalized_tags_json, '$.genres') = 'array'
              THEN json_extract(f.normalized_tags_json, '$.genres') ELSE json('[]') END) selected_genre
            WHERE NULLIF(TRIM(CAST(selected_genre.value AS TEXT)), '') IS NOT NULL)`
          : "";
      const genreParameters = request.genre ? [request.genre] : [];
      const search = request.query
        ? ` AND (t.title LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR json_extract(f.normalized_tags_json, '$.artist') LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR a.title LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR a.album_artist LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR f.format LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM json_each(CASE
              WHEN json_type(f.normalized_tags_json, '$.genres') = 'array'
              THEN json_extract(f.normalized_tags_json, '$.genres') ELSE json('[]') END) searched_genre
            WHERE CAST(searched_genre.value AS TEXT) LIKE ? ESCAPE '\\' COLLATE NOCASE)
          OR f.path LIKE ? ESCAPE '\\' COLLATE NOCASE)`
        : "";
      const searchParameters = request.query
        ? [pattern, pattern, pattern, pattern, pattern, pattern, pattern]
        : [];
      const trackTables = request.folderId
        ? ` FROM catalog_file_folders folder INDEXED BY catalog_file_folders_by_folder
          JOIN audio_files f ON f.id=folder.file_id
          JOIN tracks t ON t.file_id=f.id
          JOIN albums a ON a.id=t.album_id`
        : ` FROM tracks t
          JOIN audio_files f ON f.id=t.file_id
          JOIN albums a ON a.id=t.album_id`;
      const visibleTracks = `${trackTables}
        WHERE f.scan_state='ok'${formatFilter}${folderFilter}${genreFilter}${search}`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*)${visibleTracks}`)
        .pluck()
        .get(
          ...formatParameters,
          ...folderParameters,
          ...genreParameters,
          ...searchParameters,
        ) as number;
      const tracks = this.connection
        .prepare(
          `SELECT f.id, a.id AS albumId, t.title,
            COALESCE(json_extract(f.normalized_tags_json, '$.artist'), '') AS artist,
            a.title AS albumTitle, a.album_artist AS albumArtist,
            t.track_number AS trackNumber, t.disc_number AS discNumber,
            COALESCE(NULLIF(TRIM(f.format), ''), 'unknown') AS format,
            f.duration_seconds AS durationSeconds, f.codec,
            f.bitrate, f.sample_rate AS sampleRate, f.bit_depth AS bitDepth,
            f.channels, f.size, f.path
           ${visibleTracks}
           ORDER BY a.album_artist, a.title, a.id,
             COALESCE(t.disc_number, 0), COALESCE(t.track_number, 0), f.path
           LIMIT ? OFFSET ?`,
        )
        .all(
          ...formatParameters,
          ...folderParameters,
          ...genreParameters,
          ...searchParameters,
          request.limit,
          request.offset,
        ) as LibraryTrackDto[];
      return {
        albums: [],
        artists: [],
        formats: [],
        folders: [],
        tracks,
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    if (request.view === "artists") {
      this.refreshCatalogSearchIfNeeded();
      const search = request.query
        ? ` AND a.album_artist LIKE ? ESCAPE '\\' COLLATE NOCASE`
        : "";
      const searchParameters = request.query ? [pattern] : [];
      const visibleArtists = ` FROM albums a
        JOIN tracks t ON t.album_id=a.id
        JOIN audio_files f ON f.id=t.file_id
        WHERE f.scan_state='ok'${search}
        GROUP BY a.album_artist COLLATE NOCASE`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*) FROM (SELECT 1${visibleArtists})`)
        .pluck()
        .get(...searchParameters) as number;
      const artists = this.connection
        .prepare(
          `SELECT MIN(a.album_artist) AS name,
            COUNT(DISTINCT a.id) AS albumCount,
            COUNT(DISTINCT f.id) AS trackCount
           ${visibleArtists}
           ORDER BY name COLLATE NOCASE, name LIMIT ? OFFSET ?`,
        )
        .all(...searchParameters, request.limit, request.offset) as {
        name: string;
        albumCount: number;
        trackCount: number;
      }[];
      return {
        albums: [],
        artists,
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems,
        offset: request.offset,
        limit: request.limit,
      };
    }

    const albumFilters: string[] = [];
    const albumParameters: string[] = [];
    if (request.albumArtist) {
      albumFilters.push("a.album_artist = ? COLLATE NOCASE");
      albumParameters.push(request.albumArtist);
    }
    if (request.albumId) {
      albumFilters.push("a.id = ?");
      albumParameters.push(request.albumId);
    }
    const albumFilter = albumFilters.join(" AND ");

    if (!request.query) {
      this.refreshCatalogSearchIfNeeded();
      const visibleAlbums = ` FROM catalog_visible_albums visible
        JOIN albums a ON a.id=visible.album_id
        ${albumReleaseDatesJoin}${albumFilter ? ` WHERE ${albumFilter}` : ""}`;
      const totalItems = this.connection
        .prepare(`SELECT COUNT(*)${visibleAlbums}`)
        .pluck()
        .get(...albumParameters) as number;
      const albumIds = this.connection
        .prepare(
          `SELECT a.id${visibleAlbums}
           ORDER BY ${albumLibraryOrder} LIMIT ? OFFSET ?`,
        )
        .all(...albumParameters, request.limit, request.offset)
        .map((row) => (row as { id: string }).id);
      return {
        albums: this.listAlbumsByIds(albumIds),
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
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
        .prepare(
          `SELECT COUNT(*) FROM (${matchingAlbums}) matched
           JOIN albums a ON a.id=matched.album_id${albumFilter ? ` WHERE ${albumFilter}` : ""}`,
        )
        .pluck()
        .get(pattern, pattern, match, ...albumParameters) as number;
      const albumIds = this.connection
        .prepare(
          `SELECT a.id FROM albums a
           JOIN (${matchingAlbums}) matched ON matched.album_id=a.id
           ${albumReleaseDatesJoin}${albumFilter ? ` WHERE ${albumFilter}` : ""}
           ORDER BY ${albumLibraryOrder} LIMIT ? OFFSET ?`,
        )
        .all(
          pattern,
          pattern,
          match,
          ...albumParameters,
          request.limit,
          request.offset,
        )
        .map((row) => (row as { id: string }).id);
      return {
        albums: this.listAlbumsByIds(albumIds),
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
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
      ${albumReleaseDatesJoin}
      WHERE f.scan_state='ok'${albumFilter ? ` AND ${albumFilter}` : ""}${search}`;
    const totalItems = this.connection
      .prepare(`SELECT COUNT(DISTINCT a.id)${from}`)
      .pluck()
      .get(...albumParameters, ...searchParameters) as number;
    const albumIds = this.connection
      .prepare(
        `SELECT DISTINCT a.id, a.album_artist, a.title,
          album_release.release_date${from}
         ORDER BY ${albumLibraryOrder} LIMIT ? OFFSET ?`,
      )
      .all(
        ...albumParameters,
        ...searchParameters,
        request.limit,
        request.offset,
      )
      .map((row) => (row as { id: string }).id);
    return {
      albums: this.listAlbumsByIds(albumIds),
      artists: [],
      formats: [],
      folders: [],
      tracks: [],
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
      const tags = hydrateRebuildableTotals(
        JSON.parse(row.normalized_tags_json ?? "{}") as NormalizedTags,
      );
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
        codec: row.codec,
        bitrate: row.bitrate,
        sampleRate: row.sample_rate,
        bitDepth: row.bit_depth,
        channels: row.channels,
        tags,
        nativeTags: JSON.parse(
          row.native_tags_json ?? "[]",
        ) as CatalogTrack["nativeTags"],
        scanError: row.scan_error,
      });
      albums.set(row.album_id, album);
    }
    const hydrated = [...albums.values()].map((album) => ({
      ...album,
      tracks: sortTracks(album.tracks),
    }));
    if (ids)
      return ids.flatMap((id) => {
        const album = hydrated.find((candidate) => candidate.id === id);
        return album ? [album] : [];
      });
    return hydrated.sort(compareAlbumsByArtistReleaseDateTitle);
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
          tags: hydrateRebuildableTotals(
            JSON.parse(row.normalized_tags_json) as NormalizedTags,
          ),
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

  createArtworkEditOperation(
    albumId: string,
    confirmationHash: string,
    action: "replace" | "remove",
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at, kind)
         VALUES (?, ?, ?, ?, 'previewed', ?,
          'album-artwork-edit')`,
      )
      .run(
        id,
        albumId,
        action === "replace"
          ? "Replace embedded front cover"
          : "Remove embedded front cover",
        confirmationHash,
        new Date().toISOString(),
      );
    return id;
  }

  createArtworkUndoOperation(
    albumId: string,
    sourceOperationId: string,
    confirmationHash: string,
  ): string {
    const id = randomUUID();
    this.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at,
          kind, source_operation_id)
         VALUES (?, ?, 'Restore embedded artwork', ?, 'previewed', ?,
          'album-artwork-undo', ?)`,
      )
      .run(
        id,
        albumId,
        confirmationHash,
        new Date().toISOString(),
        sourceOperationId,
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
          | "track-number-sequence-edit"
          | "album-artwork-edit"
          | "album-artwork-undo";
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
            | "track-number-sequence-edit"
            | "album-artwork-edit"
            | "album-artwork-undo";
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
        | "track-number-sequence-edit"
        | "album-artwork-edit"
        | "album-artwork-undo";
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
      before: hydrateRebuildableTotals(
        JSON.parse(row.before_tags_json) as NormalizedTags,
      ),
      after: hydrateRebuildableTotals(
        JSON.parse(row.after_tags_json) as NormalizedTags,
      ),
      current: hydrateRebuildableTotals(
        JSON.parse(row.normalized_tags_json ?? "{}") as NormalizedTags,
      ),
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

  saveArtworkSnapshot(
    operationId: string,
    fileId: string,
    tags: NormalizedTags,
    before: readonly StoredArtworkPicture[],
    after: readonly StoredArtworkPicture[],
  ): string {
    return this.connection.transaction(() => {
      const snapshotId = this.saveSnapshot(operationId, fileId, tags, tags);
      const insertAsset = this.connection.prepare(
        `INSERT INTO artwork_assets (sha256, mime_type, data)
         VALUES (?, ?, ?) ON CONFLICT(sha256) DO NOTHING`,
      );
      const insertPicture = this.connection.prepare(
        `INSERT INTO artwork_snapshot_pictures
         (snapshot_id, side, position, asset_sha256, kind, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const [side, pictures] of [
        ["before", before],
        ["after", after],
      ] as const) {
        pictures.forEach((picture, position) => {
          const sha256 = createHash("sha256")
            .update(picture.data)
            .digest("hex");
          insertAsset.run(sha256, picture.mimeType, Buffer.from(picture.data));
          insertPicture.run(
            snapshotId,
            side,
            position,
            sha256,
            picture.kind,
            picture.description ?? null,
          );
        });
      }
      return snapshotId;
    })();
  }

  listArtworkSnapshots(operationId: string): readonly StoredArtworkSnapshot[] {
    const snapshots = this.listSnapshots(operationId);
    const rows = this.connection
      .prepare(
        `SELECT picture.snapshot_id, picture.side, picture.position,
          picture.kind, picture.description, asset.mime_type, asset.data
         FROM artwork_snapshot_pictures picture
         JOIN artwork_assets asset ON asset.sha256=picture.asset_sha256
         JOIN tag_snapshots snapshot ON snapshot.id=picture.snapshot_id
         WHERE snapshot.operation_id=?
         ORDER BY picture.snapshot_id, picture.side, picture.position`,
      )
      .all(operationId) as {
      snapshot_id: string;
      side: "before" | "after";
      position: number;
      kind: number;
      description: string | null;
      mime_type: string;
      data: Buffer;
    }[];
    const pictures = new Map<
      string,
      { before: StoredArtworkPicture[]; after: StoredArtworkPicture[] }
    >();
    for (const row of rows) {
      const entry = pictures.get(row.snapshot_id) ?? {
        before: [],
        after: [],
      };
      entry[row.side].push({
        mimeType: row.mime_type,
        kind: row.kind,
        ...(row.description === null ? {} : { description: row.description }),
        data: new Uint8Array(row.data),
      });
      pictures.set(row.snapshot_id, entry);
    }
    return snapshots.map((snapshot) => {
      const stored = pictures.get(snapshot.id) ?? { before: [], after: [] };
      return {
        ...snapshot,
        beforePictures: stored.before,
        afterPictures: stored.after,
      };
    });
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
      .prepare(
        `SELECT f.root_id, f.path_key, t.album_id
         FROM audio_files f JOIN tracks t ON t.file_id=f.id WHERE f.id=?`,
      )
      .get(fileId) as { root_id: string; path_key: string; album_id: string };
    this.connection.transaction(() =>
      this.upsertScannedFileInTransaction(
        row.root_id,
        row.path_key,
        file,
        row.album_id,
      ),
    )();
    this.catalogSearchDirty = true;
  }

  private refreshCatalogSearchIfNeeded(): void {
    if (!this.catalogSearchDirty) return;
    this.rebuildCatalogSearch();
    this.catalogSearchDirty = false;
  }

  refreshConnectionLocalProjections(): void {
    this.rebuildFolderCatalog();
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
    this.rebuildFolderCatalog();
  }

  private rebuildFolderCatalog(): void {
    this.connection.exec(`
      DELETE FROM catalog_file_folders;
      INSERT INTO catalog_file_folders(file_id, folder_id, path)
      SELECT id, outgroove_parent_folder_key(path_key),
        outgroove_parent_folder_path(path)
      FROM audio_files
      WHERE scan_state='ok';
      DELETE FROM catalog_folders;
      INSERT INTO catalog_folders(id, path, album_count, track_count)
      SELECT folder.folder_id, MIN(folder.path),
        COUNT(DISTINCT track.album_id), COUNT(DISTINCT folder.file_id)
      FROM catalog_file_folders folder
      JOIN tracks track ON track.file_id=folder.file_id
      GROUP BY folder.folder_id;
    `);
  }

  createSyncProfile(
    name: string,
    targetPath: string,
    albumIds: readonly string[],
  ): { id: string; name: string; targetPath: string; albumIds: string[] } {
    const selectedAlbumIds = this.validateSyncProfileAlbumIds(albumIds);
    const id = randomUUID();
    this.connection.transaction(() => {
      this.connection
        .prepare(
          "INSERT INTO sync_profiles (id, name, target_path, album_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          id,
          name,
          targetPath,
          selectedAlbumIds[0],
          new Date().toISOString(),
        );
      const insertSelection = this.connection.prepare(
        "INSERT INTO sync_profile_albums (profile_id, album_id) VALUES (?, ?)",
      );
      for (const albumId of selectedAlbumIds) insertSelection.run(id, albumId);
    })();
    return { id, name, targetPath, albumIds: selectedAlbumIds };
  }

  private validateSyncProfileAlbumIds(albumIds: readonly string[]): string[] {
    const selectedAlbumIds = [...new Set(albumIds)].sort();
    if (
      selectedAlbumIds.length < 1 ||
      selectedAlbumIds.length > 100 ||
      selectedAlbumIds.length !== albumIds.length
    )
      throw new Error("Choose between 1 and 100 distinct albums.");
    const existingAlbums = this.connection
      .prepare(
        `SELECT COUNT(*) FROM albums
         WHERE id IN (${selectedAlbumIds.map(() => "?").join(",")})`,
      )
      .pluck()
      .get(...selectedAlbumIds) as number;
    if (existingAlbums !== selectedAlbumIds.length)
      throw new Error("One or more selected albums no longer exist.");
    return selectedAlbumIds;
  }

  updateSyncProfileAlbums(
    id: string,
    albumIds: readonly string[],
  ): SyncProfileDto {
    const selectedAlbumIds = this.validateSyncProfileAlbumIds(albumIds);
    this.connection.transaction(() => {
      const updated = this.connection
        .prepare("UPDATE sync_profiles SET album_id=? WHERE id=?")
        .run(selectedAlbumIds[0], id);
      if (updated.changes === 0)
        throw new Error("Sync profile no longer exists.");
      this.connection
        .prepare("DELETE FROM sync_profile_albums WHERE profile_id=?")
        .run(id);
      const insertSelection = this.connection.prepare(
        "INSERT INTO sync_profile_albums (profile_id, album_id) VALUES (?, ?)",
      );
      for (const albumId of selectedAlbumIds) insertSelection.run(id, albumId);
    })();
    const profile = this.listSyncProfiles().find(
      (candidate) => candidate.id === id,
    );
    if (!profile) throw new Error("Updated sync profile could not be loaded.");
    return profile;
  }

  renameSyncProfile(id: string, name: string): SyncProfileDto {
    const normalizedName = name.trim();
    if (normalizedName.length < 1 || normalizedName.length > 100)
      throw new Error(
        "Choose a DAP profile name between 1 and 100 characters.",
      );
    const updated = this.connection
      .prepare("UPDATE sync_profiles SET name=? WHERE id=?")
      .run(normalizedName, id);
    if (updated.changes === 0)
      throw new Error("Sync profile no longer exists.");
    const profile = this.listSyncProfiles().find(
      (candidate) => candidate.id === id,
    );
    if (!profile) throw new Error("Renamed sync profile could not be loaded.");
    return profile;
  }

  updateSyncProfileTarget(id: string, targetPath: string): SyncProfileDto {
    const updated = this.connection
      .prepare("UPDATE sync_profiles SET target_path=? WHERE id=?")
      .run(targetPath, id);
    if (updated.changes === 0)
      throw new Error("Sync profile no longer exists.");
    const profile = this.listSyncProfiles().find(
      (candidate) => candidate.id === id,
    );
    if (!profile)
      throw new Error("Retargeted sync profile could not be loaded.");
    return profile;
  }

  listSyncProfiles(): readonly SyncProfileDto[] {
    const rows = this.connection
      .prepare(
        `SELECT profile.id, profile.name, profile.target_path,
           profile.created_at, album.id AS album_id,
           album.title AS album_title, album.album_artist
         FROM sync_profiles profile
         LEFT JOIN sync_profile_albums selection
           ON selection.profile_id=profile.id
         LEFT JOIN albums album ON album.id=selection.album_id
         ORDER BY profile.created_at DESC, profile.id,
           album.album_artist COLLATE NOCASE, album.title COLLATE NOCASE,
           album.id`,
      )
      .all() as {
      id: string;
      name: string;
      target_path: string;
      created_at: string;
      album_id: string | null;
      album_title: string | null;
      album_artist: string | null;
    }[];
    const profiles = new Map<string, SyncProfileDto>();
    for (const row of rows) {
      if (
        row.album_id === null ||
        row.album_title === null ||
        row.album_artist === null
      )
        throw new Error(`Sync profile “${row.name}” has no selected albums.`);
      const existing = profiles.get(row.id);
      const album = {
        id: row.album_id,
        title: row.album_title,
        albumArtist: row.album_artist,
      };
      if (existing) {
        profiles.set(row.id, {
          ...existing,
          albumIds: [...existing.albumIds, album.id],
          albums: [...existing.albums, album],
        });
      } else {
        profiles.set(row.id, {
          id: row.id,
          name: row.name,
          targetPath: row.target_path,
          albumIds: [album.id],
          albums: [album],
          createdAt: row.created_at,
        });
      }
    }
    return [...profiles.values()];
  }

  getSyncProfile(id: string):
    | {
        id: string;
        name: string;
        target_path: string;
        album_id: string;
        album_ids: readonly string[];
        album_selections: readonly { id: string; title: string }[];
      }
    | undefined {
    const profile = this.connection
      .prepare(
        "SELECT id, name, target_path, album_id FROM sync_profiles WHERE id=?",
      )
      .get(id) as
      | { id: string; name: string; target_path: string; album_id: string }
      | undefined;
    if (!profile) return undefined;
    const albumSelections = this.connection
      .prepare(
        `SELECT selection.album_id AS id, album.title
         FROM sync_profile_albums selection
         JOIN albums album ON album.id=selection.album_id
         WHERE selection.profile_id=? ORDER BY selection.album_id`,
      )
      .all(id) as { id: string; title: string }[];
    if (albumSelections.length === 0)
      throw new Error("Sync profile has no selected albums.");
    return {
      ...profile,
      album_ids: albumSelections.map((selection) => selection.id),
      album_selections: albumSelections,
    };
  }

  getLatestManifest(
    profileId: string,
    targetPath: string,
  ): { manifest_json: string } | undefined {
    return this.connection
      .prepare(
        `SELECT manifest_json FROM sync_manifests
         WHERE profile_id=? AND target_path=?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(profileId, targetPath) as { manifest_json: string } | undefined;
  }

  createSyncRun(
    planId: string,
    profileId: string,
    targetPath: string,
  ): SyncRunRecord {
    if (this.getSyncRunForProfile(profileId))
      throw new Error(
        "Recover this profile's interrupted sync before applying another plan.",
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO sync_runs
         (id, plan_id, profile_id, target_path, phase, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'copying', 'applying', ?, ?)`,
      )
      .run(id, planId, profileId, targetPath, now, now);
    const run = this.getSyncRun(id);
    if (!run)
      throw new Error("Created sync recovery journal could not be read.");
    return run;
  }

  addSyncRunChange(
    runId: string,
    change: Omit<SyncRunChangeRecord, "id" | "sequence" | "installed">,
  ): SyncRunChangeRecord {
    const id = randomUUID();
    this.connection.transaction(() => {
      const sequence = this.connection
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1
           FROM sync_run_changes WHERE run_id=?`,
        )
        .pluck()
        .get(runId) as number;
      this.connection
        .prepare(
          `INSERT INTO sync_run_changes
           (id, run_id, sequence, kind, relative_destination,
            temporary_relative, rollback_relative, expected_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          runId,
          sequence,
          change.kind,
          change.relativeDestination,
          change.temporaryRelative,
          change.rollbackRelative,
          change.expectedHash,
        );
      this.connection
        .prepare("UPDATE sync_runs SET updated_at=? WHERE id=?")
        .run(new Date().toISOString(), runId);
    })();
    const recorded = this.getSyncRun(runId)?.changes.find(
      (candidate) => candidate.id === id,
    );
    if (!recorded) throw new Error("Sync recovery change could not be read.");
    return recorded;
  }

  markSyncRunChangeInstalled(runId: string, changeId: string): void {
    const updated = this.connection
      .prepare(
        `UPDATE sync_run_changes SET installed=1
         WHERE id=? AND run_id=?`,
      )
      .run(changeId, runId);
    if (updated.changes !== 1)
      throw new Error("Sync recovery change no longer exists.");
    this.connection
      .prepare("UPDATE sync_runs SET updated_at=? WHERE id=?")
      .run(new Date().toISOString(), runId);
  }

  deleteSyncRunChange(runId: string, changeId: string): void {
    this.connection
      .prepare("DELETE FROM sync_run_changes WHERE id=? AND run_id=?")
      .run(changeId, runId);
    this.connection
      .prepare("UPDATE sync_runs SET updated_at=? WHERE id=?")
      .run(new Date().toISOString(), runId);
  }

  updateSyncRun(
    runId: string,
    update: {
      phase?: SyncRunRecord["phase"];
      state?: SyncRunRecord["state"];
    },
  ): SyncRunRecord {
    const current = this.getSyncRun(runId);
    if (!current) throw new Error("Sync recovery journal does not exist.");
    this.connection
      .prepare(`UPDATE sync_runs SET phase=?, state=?, updated_at=? WHERE id=?`)
      .run(
        update.phase ?? current.phase,
        update.state ?? current.state,
        new Date().toISOString(),
        runId,
      );
    const updated = this.getSyncRun(runId);
    if (!updated) throw new Error("Updated sync recovery journal is missing.");
    return updated;
  }

  deleteSyncRun(runId: string): void {
    this.connection.prepare("DELETE FROM sync_runs WHERE id=?").run(runId);
  }

  getSyncRunForProfile(profileId: string): SyncRunRecord | undefined {
    const id = this.connection
      .prepare("SELECT id FROM sync_runs WHERE profile_id=?")
      .pluck()
      .get(profileId) as string | undefined;
    return id ? this.getSyncRun(id) : undefined;
  }

  getSyncRun(runId: string): SyncRunRecord | undefined {
    const row = this.connection
      .prepare(
        `SELECT run.*, profile.name AS profile_name
         FROM sync_runs run
         JOIN sync_profiles profile ON profile.id=run.profile_id
         WHERE run.id=?`,
      )
      .get(runId) as
      | {
          id: string;
          plan_id: string;
          profile_id: string;
          profile_name: string;
          target_path: string;
          phase: SyncRunRecord["phase"];
          state: SyncRunRecord["state"];
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    const changes = this.connection
      .prepare(
        `SELECT id, sequence, kind, relative_destination,
           temporary_relative, rollback_relative, expected_hash, installed
         FROM sync_run_changes WHERE run_id=? ORDER BY sequence`,
      )
      .all(runId) as {
      id: string;
      sequence: number;
      kind: SyncRunChangeRecord["kind"];
      relative_destination: string;
      temporary_relative: string;
      rollback_relative: string | null;
      expected_hash: string;
      installed: 0 | 1;
    }[];
    return {
      id: row.id,
      planId: row.plan_id,
      profileId: row.profile_id,
      profileName: row.profile_name,
      targetPath: row.target_path,
      phase: row.phase,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      changes: changes.map((change) => ({
        id: change.id,
        sequence: change.sequence,
        kind: change.kind,
        relativeDestination: change.relative_destination,
        temporaryRelative: change.temporary_relative,
        rollbackRelative: change.rollback_relative,
        expectedHash: change.expected_hash,
        installed: change.installed === 1,
      })),
    };
  }

  listSyncRuns(): readonly SyncRunRecord[] {
    const ids = this.connection
      .prepare("SELECT id FROM sync_runs ORDER BY created_at, id")
      .pluck()
      .all() as string[];
    return ids.flatMap((id) => {
      const run = this.getSyncRun(id);
      return run ? [run] : [];
    });
  }

  listSyncHistory(profileId: string): readonly SyncHistoryItemDto[] {
    const profileExists = this.connection
      .prepare("SELECT 1 FROM sync_profiles WHERE id=?")
      .pluck()
      .get(profileId);
    if (!profileExists) throw new Error("Sync profile no longer exists.");
    const rows = this.connection
      .prepare(
        `SELECT manifest.id, manifest.profile_id, manifest.target_path,
           manifest.created_at, COUNT(entry.id) AS entry_count
         FROM sync_manifests manifest
         LEFT JOIN sync_entries entry ON entry.manifest_id=manifest.id
         WHERE manifest.profile_id=?
         GROUP BY manifest.id, manifest.profile_id, manifest.target_path,
           manifest.created_at
         ORDER BY manifest.created_at DESC, manifest.id DESC
         LIMIT 20`,
      )
      .all(profileId) as {
      id: string;
      profile_id: string;
      target_path: string;
      created_at: string;
      entry_count: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      targetPath: row.target_path,
      completedAt: row.created_at,
      entryCount: row.entry_count,
    }));
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
    this.connection.transaction(() =>
      this.insertManifest(profileId, targetPath, manifest),
    )();
  }

  completeSyncRun(
    runId: string,
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
    this.connection.transaction(() => {
      const run = this.getSyncRun(runId);
      if (!run) throw new Error("Sync recovery journal no longer exists.");
      if (run.profileId !== profileId || run.targetPath !== targetPath)
        throw new Error("Sync recovery journal no longer matches this plan.");
      this.insertManifest(profileId, targetPath, manifest);
      this.connection
        .prepare(
          `UPDATE sync_runs SET state='committed-cleanup', updated_at=?
           WHERE id=?`,
        )
        .run(new Date().toISOString(), runId);
    })();
  }

  private insertManifest(
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
  }
}
