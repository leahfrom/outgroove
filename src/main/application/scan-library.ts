import { normalize, resolve } from "node:path";

import type { ScanResultDto } from "../../shared/contracts/api";
import type { ScannedAudioFile } from "../../shared/domain/catalog";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import {
  NodeLibraryFileSystem,
  type LibraryFileSystem,
} from "../adapters/filesystem/library-filesystem";
import type {
  MetadataJobResult,
  MetadataJobRunner,
} from "../jobs/metadata-runner";
import type { ScanCatalog } from "./scan-catalog";
import type { ScanDatabaseDiscoveryEntry } from "../../shared/contracts/scan-database-worker";

const DISCOVERY_BATCH_SIZE = 250;
const METADATA_PAGE_SIZE = 5_000;

export type ScanProgress =
  | {
      readonly phase: "discovery";
      readonly discovered: number;
      readonly folderErrors: number;
    }
  | {
      readonly phase: "metadata";
      readonly completed: number;
      readonly total: number;
      readonly path: string;
    };

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
    private readonly scanCatalog: ScanCatalog = database,
  ) {}

  async execute(
    rootId: string,
    onProgress: (progress: ScanProgress) => void = () => undefined,
    signal?: AbortSignal,
  ): Promise<ScanResultDto> {
    const root = this.database.getLibraryRoot(rootId);
    if (!root) throw new Error("Library root does not exist.");
    await this.scanCatalog.beginScan(rootId);
    try {
      let errors = 0;
      let discovered = 0;
      let folderErrors = 0;
      let unchanged = 0;
      let changedCount = 0;
      let discoveryBatch: ScanDatabaseDiscoveryEntry[] = [];
      const flushDiscoveryBatch = async (): Promise<void> => {
        if (discoveryBatch.length === 0) return;
        const entries = discoveryBatch;
        discoveryBatch = [];
        const result = await this.scanCatalog.recordScanDiscoveryBatch(
          rootId,
          entries,
        );
        unchanged += result.unchanged;
        changedCount += result.changed;
      };
      for await (const item of this.fileSystem.discover(root.path, signal)) {
        throwIfCancelled(signal);
        if (item.kind === "directory-error") {
          errors++;
          folderErrors++;
          discoveryBatch.push({
            kind: "directory-error",
            path: item.path,
            pathKey: pathComparisonKey(item.path),
            message: item.message,
          });
          onProgress({
            phase: "discovery",
            discovered,
            folderErrors,
          });
          if (discoveryBatch.length === DISCOVERY_BATCH_SIZE)
            await flushDiscoveryBatch();
          continue;
        }
        const path = item.path;
        const pathKey = pathComparisonKey(path);
        if (item.kind === "file-error") {
          errors++;
          discovered++;
          discoveryBatch.push({
            kind: "file-error",
            path,
            pathKey,
            message: item.message,
          });
          onProgress({
            phase: "discovery",
            discovered,
            folderErrors,
          });
          if (discoveryBatch.length === DISCOVERY_BATCH_SIZE)
            await flushDiscoveryBatch();
          continue;
        }
        discoveryBatch.push({
          kind: "file",
          path,
          pathKey,
          size: item.size,
          modifiedMs: item.modifiedMs,
        });
        discovered++;
        onProgress({
          phase: "discovery",
          discovered,
          folderErrors,
        });
        if (discoveryBatch.length === DISCOVERY_BATCH_SIZE)
          await flushDiscoveryBatch();
      }
      await flushDiscoveryBatch();
      onProgress({
        phase: "metadata",
        completed: 0,
        total: changedCount,
        path: "",
      });

      let parsed = 0;
      let processed = 0;
      let afterSequence = -1;
      let successfulBatch: { pathKey: string; file: ScannedAudioFile }[] = [];
      const flushSuccessfulBatch = async (): Promise<void> => {
        if (successfulBatch.length === 0) return;
        const files = successfulBatch;
        successfulBatch = [];
        await this.scanCatalog.upsertScannedFiles(rootId, files);
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
        await this.scanCatalog.upsertScanError(
          rootId,
          result.path,
          pathComparisonKey(result.path),
          info.size,
          info.modifiedMs,
          result.error,
        );
      };
      throwIfCancelled(signal);
      let page = await this.scanCatalog.listChangedScanPaths(
        rootId,
        afterSequence,
        METADATA_PAGE_SIZE,
      );
      while (page.length > 0) {
        await this.metadata.processAll(
          page.map((entry) => entry.path),
          async (result) => {
            throwIfCancelled(signal);
            if (result.ok) {
              parsed++;
              successfulBatch.push({
                pathKey: pathComparisonKey(result.file.path),
                file: result.file,
              });
              if (successfulBatch.length === 250) await flushSuccessfulBatch();
            } else {
              await flushSuccessfulBatch();
              errors++;
              await persistError(result);
            }
          },
          (completed, _total, path) =>
            onProgress({
              phase: "metadata",
              completed: processed + completed,
              total: changedCount,
              path,
            }),
          signal,
        );
        await flushSuccessfulBatch();
        processed += page.length;
        const last = page.at(-1);
        if (!last) throw new Error("Changed-path page unexpectedly empty.");
        afterSequence = last.sequence;
        throwIfCancelled(signal);
        page = await this.scanCatalog.listChangedScanPaths(
          rootId,
          afterSequence,
          METADATA_PAGE_SIZE,
        );
      }
      throwIfCancelled(signal);
      await this.scanCatalog.finishScan(rootId);
      if (this.scanCatalog !== this.database)
        this.database.refreshConnectionLocalProjections();
      return { parsed, unchanged, errors };
    } catch (error) {
      try {
        await this.scanCatalog.abandonScan(rootId);
        if (this.scanCatalog !== this.database)
          this.database.refreshConnectionLocalProjections();
      } catch {
        // A crashed worker loses its temporary scan tables with its connection.
      }
      throw error;
    }
  }
}
