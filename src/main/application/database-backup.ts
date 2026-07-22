import { createHash, randomUUID } from "node:crypto";
import { copyFile, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

import type {
  DatabaseBackupResultDto,
  DatabaseRestorePreviewDto,
} from "../../shared/contracts/api";
import { CatalogDatabase } from "../adapters/database/catalog-database";
import { migrations } from "../adapters/database/migrations";

interface PendingRestore extends DatabaseRestorePreviewDto {
  stagingPath: string;
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function bestEffortUnlink(path: string): Promise<void> {
  try {
    await unlinkIfExists(path);
  } catch {
    // A verified replacement is already committed; stale hidden originals are
    // safer than deleting the new database to retry cleanup.
  }
}

async function renameIfExists(
  source: string,
  destination: string,
): Promise<boolean> {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function flush(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function verifyReadableDatabase(path: string): number {
  const candidate = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.pragma("integrity_check", { simple: true });
    if (integrity !== "ok")
      throw new Error(`Backup integrity check failed: ${String(integrity)}`);
    return candidate.pragma("user_version", { simple: true }) as number;
  } finally {
    candidate.close();
  }
}

export class DatabaseBackupService {
  private readonly previews = new Map<string, PendingRestore>();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly databasePath: string,
  ) {}

  async exportTo(destinationPath: string): Promise<DatabaseBackupResultDto> {
    if (resolve(destinationPath) === resolve(this.databasePath))
      throw new Error(
        "The active Outgroove database cannot be overwritten by an export.",
      );
    const temporary = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.outgroove-${randomUUID()}.tmp`,
    );
    const previous = `${temporary}.previous`;
    let movedPrevious = false;
    try {
      await this.database.backup(temporary);
      await flush(temporary);
      verifyReadableDatabase(temporary);
      movedPrevious = await renameIfExists(destinationPath, previous);
      await rename(temporary, destinationPath);
      if (movedPrevious) await unlinkIfExists(previous);
      return { path: destinationPath };
    } catch (error) {
      await unlinkIfExists(temporary);
      if (movedPrevious) await rename(previous, destinationPath);
      throw error;
    }
  }

  async previewRestore(sourcePath: string): Promise<DatabaseRestorePreviewDto> {
    if (resolve(sourcePath) === resolve(this.databasePath))
      throw new Error(
        "Choose an exported backup, not the active Outgroove database.",
      );
    const sourceVersion = verifyReadableDatabase(sourcePath);
    const currentVersion = migrations.at(-1)?.version ?? 0;
    if (sourceVersion < 1 || sourceVersion > currentVersion)
      throw new Error(
        `Backup schema version ${sourceVersion} is not supported by this Outgroove build.`,
      );
    const stagingPath = `${this.databasePath}.restore-${randomUUID()}.staging`;
    await copyFile(sourcePath, stagingPath);
    let staged: CatalogDatabase | undefined;
    try {
      staged = new CatalogDatabase(stagingPath);
      const integrity = staged.connection.pragma("integrity_check", {
        simple: true,
      });
      if (integrity !== "ok")
        throw new Error("Staged backup failed integrity verification.");
      const summary = {
        libraryRoots: staged.connection
          .prepare(
            "SELECT COUNT(*) FROM library_roots WHERE removed_at IS NULL",
          )
          .pluck()
          .get() as number,
        albums: staged.connection
          .prepare("SELECT COUNT(*) FROM albums")
          .pluck()
          .get() as number,
        tracks: staged.connection
          .prepare("SELECT COUNT(*) FROM tracks")
          .pluck()
          .get() as number,
        syncProfiles: staged.connection
          .prepare("SELECT COUNT(*) FROM sync_profiles")
          .pluck()
          .get() as number,
        savedLibraryFilters: staged.connection
          .prepare("SELECT COUNT(*) FROM saved_library_filters")
          .pluck()
          .get() as number,
      };
      staged.close();
      staged = undefined;
      const operationId = randomUUID();
      const info = await stat(stagingPath);
      const confirmationToken = createHash("sha256")
        .update(`${operationId}:${info.size}:${JSON.stringify(summary)}`)
        .digest("base64url");
      const preview: PendingRestore = {
        operationId,
        confirmationToken,
        sourceName: basename(sourcePath),
        schemaVersion: currentVersion,
        summary,
        stagingPath,
      };
      this.previews.set(operationId, preview);
      return {
        operationId: preview.operationId,
        confirmationToken: preview.confirmationToken,
        sourceName: preview.sourceName,
        schemaVersion: preview.schemaVersion,
        summary: preview.summary,
      };
    } catch (error) {
      staged?.close();
      await unlinkIfExists(stagingPath);
      throw error;
    }
  }

  async applyRestore(
    operationId: string,
    confirmationToken: string,
  ): Promise<{ rollbackBackupPath: string; restarting: true }> {
    const preview = this.previews.get(operationId);
    if (preview?.confirmationToken !== confirmationToken)
      throw new Error("Restore must be applied from its current preview.");
    const activeJobs = this.database.connection
      .prepare(
        "SELECT COUNT(*) FROM jobs WHERE state IN ('queued', 'running', 'cancelling')",
      )
      .pluck()
      .get() as number;
    if (activeJobs > 0)
      throw new Error("Cancel active scans before restoring a backup.");
    verifyReadableDatabase(preview.stagingPath);
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const rollbackBackupPath = join(
      dirname(this.databasePath),
      `outgroove-before-restore-${stamp}.sqlite3`,
    );
    await this.database.backup(rollbackBackupPath);
    await flush(rollbackBackupPath);
    verifyReadableDatabase(rollbackBackupPath);

    const original = `${this.databasePath}.restore-original-${randomUUID()}`;
    const originalWal = `${original}-wal`;
    const originalShm = `${original}-shm`;
    this.database.close();
    let hadDatabase = false;
    let hadWal = false;
    let hadShm = false;
    try {
      hadDatabase = await renameIfExists(this.databasePath, original);
      hadWal = await renameIfExists(`${this.databasePath}-wal`, originalWal);
      hadShm = await renameIfExists(`${this.databasePath}-shm`, originalShm);
      await rename(preview.stagingPath, this.databasePath);
      const verified = new CatalogDatabase(this.databasePath);
      const integrity = verified.connection.pragma("integrity_check", {
        simple: true,
      });
      verified.close();
      if (integrity !== "ok")
        throw new Error("Replacement database failed verification.");
      if (hadDatabase) await bestEffortUnlink(original);
      if (hadWal) await bestEffortUnlink(originalWal);
      if (hadShm) await bestEffortUnlink(originalShm);
      this.previews.delete(operationId);
      return { rollbackBackupPath, restarting: true };
    } catch (error) {
      const failed = `${this.databasePath}.restore-failed-${randomUUID()}`;
      await renameIfExists(this.databasePath, failed);
      await renameIfExists(`${this.databasePath}-wal`, `${failed}-wal`);
      await renameIfExists(`${this.databasePath}-shm`, `${failed}-shm`);
      if (hadDatabase) await rename(original, this.databasePath);
      if (hadWal) await rename(originalWal, `${this.databasePath}-wal`);
      if (hadShm) await rename(originalShm, `${this.databasePath}-shm`);
      throw error;
    }
  }
}
