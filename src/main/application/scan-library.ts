import { readdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import type { ScanResultDto } from "../../shared/contracts/api";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { MetadataJobRunner } from "../jobs/metadata-runner";

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

export function pathComparisonKey(path: string): string {
  return normalize(resolve(path)).normalize("NFC").toLocaleLowerCase("en-US");
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
}

async function enumerateAudioFiles(
  root: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    throwIfCancelled(signal);
    const directory = pending.pop();
    if (!directory) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      throwIfCancelled(signal);
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))
      )
        files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
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
    const paths = await enumerateAudioFiles(root.path, signal);
    const seenKeys: string[] = [];
    const changed: string[] = [];
    let unchanged = 0;
    for (const path of paths) {
      throwIfCancelled(signal);
      const pathKey = pathComparisonKey(path);
      seenKeys.push(pathKey);
      try {
        const info = await stat(path);
        const existing = this.database.getFileByPathKey(pathKey);
        if (
          existing?.size === info.size &&
          Math.trunc(existing.modified_ms) === Math.trunc(info.mtimeMs)
        )
          unchanged++;
        else changed.push(path);
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
    }
    let errors = 0;
    const results = await this.metadata.readAll(changed, onProgress, signal);
    for (const result of results) {
      throwIfCancelled(signal);
      if (result.ok)
        this.database.upsertScannedFile(
          rootId,
          pathComparisonKey(result.file.path),
          result.file,
        );
      else {
        errors++;
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
      }
    }
    throwIfCancelled(signal);
    this.database.finishScan(rootId, seenKeys);
    return { parsed: results.length - errors, unchanged, errors };
  }
}
