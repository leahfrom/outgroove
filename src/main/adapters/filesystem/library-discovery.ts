import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import type { LibraryDiscoveryItem } from "../../../shared/contracts/library-discovery-worker";

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

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
}

export async function* discoverLibraryFiles(
  root: string,
  signal?: AbortSignal,
): AsyncGenerator<LibraryDiscoveryItem> {
  const pending = [root];
  while (pending.length > 0) {
    throwIfCancelled(signal);
    const directory = pending.pop();
    if (!directory) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      yield {
        kind: "directory-error",
        path: directory,
        message: error instanceof Error ? error.message : String(error),
      };
      continue;
    }
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
      ) {
        try {
          const info = await stat(path);
          yield {
            kind: "file",
            path,
            size: info.size,
            modifiedMs: info.mtimeMs,
          };
        } catch (error) {
          yield {
            kind: "file-error",
            path,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
    for (let index = directories.length - 1; index >= 0; index--) {
      const path = directories[index];
      if (path) pending.push(path);
    }
  }
}

export async function statLibraryFile(
  path: string,
): Promise<{ readonly size: number; readonly modifiedMs: number }> {
  const info = await stat(path);
  return { size: info.size, modifiedMs: info.mtimeMs };
}
