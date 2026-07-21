import { Worker } from "node:worker_threads";
import { join } from "node:path";

import type { ScannedAudioFile } from "../../shared/domain/catalog";
import type { MetadataReader } from "../adapters/metadata/metadata-reader";

export type MetadataJobResult =
  | { ok: true; file: ScannedAudioFile }
  | { ok: false; path: string; error: string };

export type MetadataResultConsumer = (
  result: MetadataJobResult,
) => void | Promise<void>;

export interface MetadataJobRunner {
  processAll(
    paths: readonly string[],
    onResult: MetadataResultConsumer,
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class LocalMetadataJobRunner implements MetadataJobRunner {
  constructor(
    private readonly reader: MetadataReader,
    private readonly concurrency = 2,
  ) {}

  async processAll(
    paths: readonly string[],
    onResult: MetadataResultConsumer,
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let next = 0;
    let completed = 0;
    const state: { failure: Error | null } = { failure: null };
    const hasFailed = (): boolean => state.failure !== null;
    const work = async (): Promise<void> => {
      while (next < paths.length && state.failure === null) {
        if (signal?.aborted) {
          state.failure = new DOMException("Scan cancelled", "AbortError");
          return;
        }
        const index = next++;
        const path = paths[index];
        if (!path) continue;
        let result: MetadataJobResult;
        try {
          result = { ok: true, file: await this.reader.read(path) };
        } catch (error) {
          result = {
            ok: false,
            path,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (signal?.aborted) {
          state.failure = new DOMException("Scan cancelled", "AbortError");
          return;
        }
        if (hasFailed()) return;
        try {
          const pending = onResult(result);
          if (pending !== undefined) await pending;
          onItem(++completed, paths.length, path);
        } catch (error) {
          state.failure = asError(error);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, paths.length) }, work),
    );
    if (state.failure !== null) throw state.failure;
  }
}

export class WorkerMetadataJobRunner implements MetadataJobRunner {
  async processAll(
    paths: readonly string[],
    onResult: MetadataResultConsumer,
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (paths.length === 0) return;
    const workers = Array.from(
      { length: Math.min(2, paths.length) },
      () => new Worker(join(__dirname, "metadata-worker.js")),
    );
    let next = 0;
    let completed = 0;
    const state: { failure: Error | null } = { failure: null };
    const hasFailed = (): boolean => state.failure !== null;
    const request = (
      worker: Worker,
      id: string,
      path: string,
    ): Promise<{ ok: boolean; file?: ScannedAudioFile; error?: string }> =>
      new Promise((resolve, reject) => {
        const cleanup = (): void => {
          worker.off("message", message);
          worker.off("error", failed);
          signal?.removeEventListener("abort", abort);
        };
        const message = (result: {
          ok: boolean;
          file?: ScannedAudioFile;
          error?: string;
        }): void => {
          cleanup();
          resolve(result);
        };
        const failed = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const abort = (): void => {
          cleanup();
          reject(new DOMException("Scan cancelled", "AbortError"));
        };
        worker.once("message", message);
        worker.once("error", failed);
        signal?.addEventListener("abort", abort, { once: true });
        try {
          worker.postMessage({ id, path });
        } catch (error) {
          cleanup();
          reject(asError(error));
        }
      });
    const work = async (worker: Worker): Promise<void> => {
      while (next < paths.length && state.failure === null) {
        if (signal?.aborted) {
          state.failure = new DOMException("Scan cancelled", "AbortError");
          return;
        }
        const index = next++;
        const path = paths[index];
        if (!path) continue;
        try {
          const message = await request(worker, String(index), path);
          if (hasFailed()) return;
          const result: MetadataJobResult =
            message.ok && message.file
              ? { ok: true, file: message.file }
              : { ok: false, path, error: message.error ?? "Worker failed" };
          const pending = onResult(result);
          if (pending !== undefined) await pending;
          onItem(++completed, paths.length, path);
        } catch (error) {
          state.failure = asError(error);
        }
      }
    };
    try {
      await Promise.all(workers.map(work));
      if (state.failure !== null) throw state.failure;
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  }
}
