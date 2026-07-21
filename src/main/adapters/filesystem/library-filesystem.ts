import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

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

export type LibraryDiscoveryItem =
  | { readonly kind: "file"; readonly path: string }
  | {
      readonly kind: "directory-error";
      readonly path: string;
      readonly message: string;
    };

export interface LibraryFileSystem {
  discover(
    root: string,
    signal?: AbortSignal,
  ): AsyncIterable<LibraryDiscoveryItem>;
  statFile(
    path: string,
  ): Promise<{ readonly size: number; readonly modifiedMs: number }>;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
}

export class NodeLibraryFileSystem implements LibraryFileSystem {
  async *discover(
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
          SUPPORTED_EXTENSIONS.has(
            extname(entry.name).toLocaleLowerCase("en-US"),
          )
        )
          yield { kind: "file", path };
      }
      for (let index = directories.length - 1; index >= 0; index--) {
        const path = directories[index];
        if (path) pending.push(path);
      }
    }
  }

  async statFile(
    path: string,
  ): Promise<{ readonly size: number; readonly modifiedMs: number }> {
    const info = await stat(path);
    return { size: info.size, modifiedMs: info.mtimeMs };
  }
}
