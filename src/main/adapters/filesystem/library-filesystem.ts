import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type {
  LibraryDiscoveryItem,
  LibraryDiscoveryWorkerRequest,
  LibraryDiscoveryWorkerResponse,
} from "../../../shared/contracts/library-discovery-worker";
import { discoverLibraryFiles, statLibraryFile } from "./library-discovery";

export type { LibraryDiscoveryItem };

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
    yield* discoverLibraryFiles(root, signal);
  }

  async statFile(
    path: string,
  ): Promise<{ readonly size: number; readonly modifiedMs: number }> {
    return statLibraryFile(path);
  }
}

export interface DiscoveryWorker {
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  off(event: "message", listener: (message: unknown) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
  off(event: "exit", listener: (code: number) => void): this;
  postMessage(message: LibraryDiscoveryWorkerRequest): void;
  terminate(): Promise<number>;
}

export type DiscoveryWorkerFactory = (path: string) => DiscoveryWorker;

export class WorkerLibraryFileSystem implements LibraryFileSystem {
  constructor(
    private readonly workerPath = join(
      __dirname,
      "library-discovery-worker.js",
    ),
    private readonly createWorker: DiscoveryWorkerFactory = (path) =>
      new Worker(path),
  ) {}

  async *discover(
    root: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LibraryDiscoveryItem> {
    throwIfCancelled(signal);
    const worker = this.createWorker(this.workerPath);
    const queued: LibraryDiscoveryWorkerResponse[] = [];
    let waiting:
      | {
          resolve: (message: LibraryDiscoveryWorkerResponse) => void;
          reject: (error: Error) => void;
        }
      | undefined;
    let failure: Error | undefined;
    const rejectWaiting = (error: Error): void => {
      failure = error;
      waiting?.reject(error);
      waiting = undefined;
    };
    const message = (value: unknown): void => {
      const response = value as LibraryDiscoveryWorkerResponse;
      if (waiting) {
        const current = waiting;
        waiting = undefined;
        current.resolve(response);
      } else queued.push(response);
    };
    const error = (workerError: Error): void => rejectWaiting(workerError);
    const exit = (code: number): void => {
      rejectWaiting(
        new Error(
          `Library discovery worker exited before completion with code ${code}.`,
        ),
      );
    };
    const abort = (): void =>
      rejectWaiting(new DOMException("Scan cancelled", "AbortError"));
    worker.on("message", message);
    worker.on("error", error);
    worker.on("exit", exit);
    signal?.addEventListener("abort", abort, { once: true });
    const receive = (): Promise<LibraryDiscoveryWorkerResponse> => {
      const next = queued.shift();
      if (next) return Promise.resolve(next);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      });
    };
    try {
      worker.postMessage({ type: "start", root });
      let response = await receive();
      while (response.type !== "complete") {
        if (response.type === "fatal") throw new Error(response.error);
        for (const item of response.items) {
          throwIfCancelled(signal);
          yield item;
        }
        worker.postMessage({ type: "ack", batchId: response.batchId });
        response = await receive();
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      worker.off("message", message);
      worker.off("error", error);
      worker.off("exit", exit);
      await worker.terminate();
    }
  }

  async statFile(
    path: string,
  ): Promise<{ readonly size: number; readonly modifiedMs: number }> {
    return statLibraryFile(path);
  }
}
