import { Worker } from "node:worker_threads";
import { join } from "node:path";

import type { ScannedAudioFile } from "../../shared/domain/catalog";
import type { MetadataReader } from "../adapters/metadata/metadata-reader";

export type MetadataJobResult =
  | { ok: true; file: ScannedAudioFile }
  | { ok: false; path: string; error: string };

export interface MetadataJobRunner {
  readAll(
    paths: readonly string[],
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<readonly MetadataJobResult[]>;
}

export class LocalMetadataJobRunner implements MetadataJobRunner {
  constructor(
    private readonly reader: MetadataReader,
    private readonly concurrency = 2,
  ) {}

  async readAll(
    paths: readonly string[],
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<readonly MetadataJobResult[]> {
    const results: MetadataJobResult[] = paths.map((path) => ({
      ok: false,
      path,
      error: "Pending",
    }));
    let next = 0;
    let completed = 0;
    const work = async (): Promise<void> => {
      while (next < paths.length) {
        if (signal?.aborted)
          throw new DOMException("Scan cancelled", "AbortError");
        const index = next++;
        const path = paths[index];
        if (!path) continue;
        try {
          results[index] = { ok: true, file: await this.reader.read(path) };
        } catch (error) {
          results[index] = {
            ok: false,
            path,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        onItem(++completed, paths.length, path);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, paths.length) }, work),
    );
    return results;
  }
}

export class WorkerMetadataJobRunner implements MetadataJobRunner {
  async readAll(
    paths: readonly string[],
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<readonly MetadataJobResult[]> {
    if (paths.length === 0) return [];
    const workers = Array.from(
      { length: Math.min(2, paths.length) },
      () => new Worker(join(__dirname, "metadata-worker.js")),
    );
    const results: MetadataJobResult[] = paths.map((path) => ({
      ok: false,
      path,
      error: "Pending",
    }));
    let next = 0;
    let completed = 0;
    await new Promise<void>((resolve, reject) => {
      const dispatch = (worker: Worker): void => {
        if (signal?.aborted) {
          reject(new DOMException("Scan cancelled", "AbortError"));
          return;
        }
        const index = next++;
        const path = paths[index];
        if (!path) {
          if (completed === paths.length) resolve();
          return;
        }
        worker.once(
          "message",
          (message: {
            ok: boolean;
            file?: ScannedAudioFile;
            error?: string;
          }) => {
            results[index] =
              message.ok && message.file
                ? { ok: true, file: message.file }
                : { ok: false, path, error: message.error ?? "Worker failed" };
            onItem(++completed, paths.length, path);
            if (completed === paths.length) resolve();
            else dispatch(worker);
          },
        );
        worker.once("error", reject);
        worker.postMessage({ id: String(index), path });
      };
      workers.forEach(dispatch);
    }).finally(async () =>
      Promise.all(workers.map((worker) => worker.terminate())).then(
        () => undefined,
      ),
    );
    return results;
  }
}
