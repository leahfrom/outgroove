import { normalize, resolve } from "node:path";

import type { ScanResultDto } from "../../shared/contracts/api";
import type { ScannedAudioFile } from "../../shared/domain/catalog";
import type {
  CatalogDatabase,
  ScanDiscoveryEntry,
} from "../adapters/database/catalog-database";
import {
  NodeLibraryFileSystem,
  type LibraryFileSystem,
} from "../adapters/filesystem/library-filesystem";
import type {
  MetadataJobResult,
  MetadataJobRunner,
} from "../jobs/metadata-runner";

const DISCOVERY_BATCH_SIZE = 250;
const METADATA_PAGE_SIZE = 5_000;

export function pathComparisonKey(path: string): string {
  return normalize(resolve(path)).normalize("NFC").toLocaleLowerCase("en-US");
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
}

export class ScanLibrary {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly metadata: MetadataJobRunner,
    private readonly fileSystem: LibraryFileSystem = new NodeLibraryFileSystem(),
  ) {}

  async execute(
    rootId: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
    signal?: AbortSignal,
  ): Promise<ScanResultDto> {
    const root = this.database.getLibraryRoot(rootId);
    if (!root) throw new Error("Library root does not exist.");
    this.database.beginScan(rootId);
    try {
      let errors = 0;
      let unchanged = 0;
      let changedCount = 0;
      let discoveryBatch: ScanDiscoveryEntry[] = [];
      const flushDiscoveryBatch = (): void => {
        if (discoveryBatch.length === 0) return;
        this.database.recordScanDiscoveryBatch(rootId, discoveryBatch);
        discoveryBatch = [];
      };
      for await (const item of this.fileSystem.discover(root.path, signal)) {
        throwIfCancelled(signal);
        if (item.kind === "directory-error") {
          flushDiscoveryBatch();
          errors++;
          this.database.recordScanDirectoryError(
            rootId,
            item.path,
            pathComparisonKey(item.path),
            item.message,
          );
          continue;
        }
        const path = item.path;
        const pathKey = pathComparisonKey(path);
        let changed: ScanDiscoveryEntry["changed"] = null;
        try {
          const info = await this.fileSystem.statFile(path);
          const existing = this.database.getFileByPathKey(pathKey);
          if (
            existing?.size === info.size &&
            Math.trunc(existing.modified_ms) === Math.trunc(info.modifiedMs)
          )
            unchanged++;
          else changed = { sequence: changedCount++, path };
        } catch (error) {
          this.database.upsertScanError(
            rootId,
            path,
            pathKey,
            0,
            0,
            error instanceof Error ? error.message : String(error),
          );
          errors++;
        }
        discoveryBatch.push({ pathKey, changed });
        if (discoveryBatch.length === DISCOVERY_BATCH_SIZE)
          flushDiscoveryBatch();
      }
      flushDiscoveryBatch();

      let parsed = 0;
      let processed = 0;
      let afterSequence = -1;
      let successfulBatch: { pathKey: string; file: ScannedAudioFile }[] = [];
      const flushSuccessfulBatch = (): void => {
        if (successfulBatch.length === 0) return;
        this.database.upsertScannedFiles(rootId, successfulBatch);
        successfulBatch = [];
      };
      const persistError = async (
        result: Extract<MetadataJobResult, { ok: false }>,
      ): Promise<void> => {
        let info = { size: 0, modifiedMs: 0 };
        try {
          info = await this.fileSystem.statFile(result.path);
        } catch {
          /* retained as an item-level error */
        }
        this.database.upsertScanError(
          rootId,
          result.path,
          pathComparisonKey(result.path),
          info.size,
          info.modifiedMs,
          result.error,
        );
      };
      throwIfCancelled(signal);
      let page = this.database.listChangedScanPaths(
        rootId,
        afterSequence,
        METADATA_PAGE_SIZE,
      );
      while (page.length > 0) {
        await this.metadata.processAll(
          page.map((entry) => entry.path),
          (result) => {
            throwIfCancelled(signal);
            if (result.ok) {
              parsed++;
              successfulBatch.push({
                pathKey: pathComparisonKey(result.file.path),
                file: result.file,
              });
              if (successfulBatch.length === 250) flushSuccessfulBatch();
            } else {
              flushSuccessfulBatch();
              errors++;
              return persistError(result);
            }
          },
          (completed, _total, path) =>
            onProgress(processed + completed, changedCount, path),
          signal,
        );
        flushSuccessfulBatch();
        processed += page.length;
        const last = page.at(-1);
        if (!last) throw new Error("Changed-path page unexpectedly empty.");
        afterSequence = last.sequence;
        throwIfCancelled(signal);
        page = this.database.listChangedScanPaths(
          rootId,
          afterSequence,
          METADATA_PAGE_SIZE,
        );
      }
      throwIfCancelled(signal);
      this.database.finishScan(rootId);
      return { parsed, unchanged, errors };
    } catch (error) {
      this.database.abandonScan(rootId);
      throw error;
    }
  }
}
