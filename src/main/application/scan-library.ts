import { readdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import type { ScanResultDto } from "../../shared/contracts/api";
import type { ScannedAudioFile } from "../../shared/domain/catalog";
import type {
  CatalogDatabase,
  ScanDiscoveryEntry,
} from "../adapters/database/catalog-database";
import type {
  MetadataJobResult,
  MetadataJobRunner,
} from "../jobs/metadata-runner";

const SUPPORTED_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".mp4",
  ".ogg",
  ".opus",
  ".wav",
  ".aiff",
  ".aif",
  ".ape",
  ".wv",
]);
const DISCOVERY_BATCH_SIZE = 250;
const METADATA_PAGE_SIZE = 5_000;

export function pathComparisonKey(path: string): string {
  return normalize(resolve(path)).normalize("NFC").toLocaleLowerCase("en-US");
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
}

async function* enumerateAudioFiles(
  root: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const pending = [root];
  while (pending.length > 0) {
    throwIfCancelled(signal);
    const directory = pending.pop();
    if (!directory) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const directories: string[] = [];
    for (const entry of entries) {
      throwIfCancelled(signal);
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) directories.push(path);
      else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))
      )
        yield path;
    }
    for (let index = directories.length - 1; index >= 0; index--) {
      const path = directories[index];
      if (path) pending.push(path);
    }
  }
}

export class ScanLibrary {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly metadata: MetadataJobRunner,
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
      let unchanged = 0;
      let changedCount = 0;
      let discoveryBatch: ScanDiscoveryEntry[] = [];
      const flushDiscoveryBatch = (): void => {
        if (discoveryBatch.length === 0) return;
        this.database.recordScanDiscoveryBatch(rootId, discoveryBatch);
        discoveryBatch = [];
      };
      for await (const path of enumerateAudioFiles(root.path, signal)) {
        throwIfCancelled(signal);
        const pathKey = pathComparisonKey(path);
        let changed: ScanDiscoveryEntry["changed"] = null;
        try {
          const info = await stat(path);
          const existing = this.database.getFileByPathKey(pathKey);
          if (
            existing?.size === info.size &&
            Math.trunc(existing.modified_ms) === Math.trunc(info.mtimeMs)
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
        }
        discoveryBatch.push({ pathKey, changed });
        if (discoveryBatch.length === DISCOVERY_BATCH_SIZE)
          flushDiscoveryBatch();
      }
      flushDiscoveryBatch();

      let errors = 0;
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
        let info = { size: 0, mtimeMs: 0 };
        try {
          info = await stat(result.path);
        } catch {
          /* retained as an item-level error */
        }
        this.database.upsertScanError(
          rootId,
          result.path,
          pathComparisonKey(result.path),
          info.size,
          info.mtimeMs,
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
