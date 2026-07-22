import type { EventEmitter } from "node:events";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type { LibraryPageDto } from "../../../shared/contracts/api";
import type {
  LibraryQualityWorkerMessage,
  LibraryQualityWorkerRequest,
} from "../../../shared/contracts/library-quality-worker";

export interface LibraryQualityWorker extends EventEmitter {
  terminate(): Promise<number>;
}

export type LibraryQualityWorkerFactory = (
  workerPath: string,
  databasePath: string,
  request: LibraryQualityWorkerRequest,
) => LibraryQualityWorker;

interface ActiveQuery {
  readonly worker: LibraryQualityWorker;
  readonly cleanup: () => void;
  readonly reject: (error: Error) => void;
}

function cancelledError(): Error {
  const error = new Error("Library data-quality query was superseded.");
  error.name = "AbortError";
  return error;
}

export class WorkerLibraryQualityQuery {
  private active: ActiveQuery | undefined;
  private generation = 0;

  constructor(
    private readonly databasePath: string,
    private readonly workerPath = join(__dirname, "library-quality-worker.js"),
    private readonly createWorker: LibraryQualityWorkerFactory = (
      path,
      catalogPath,
      request,
    ) =>
      new Worker(path, {
        workerData: { databasePath: catalogPath, request },
      }),
  ) {}

  async query(
    request: LibraryQualityWorkerRequest,
    onProgress?: (completed: number, total: number, detail: string) => void,
  ): Promise<LibraryPageDto> {
    const generation = ++this.generation;
    await this.cancelActive();
    if (generation !== this.generation) throw cancelledError();
    const worker = this.createWorker(
      this.workerPath,
      this.databasePath,
      request,
    );
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        worker.off("message", message);
        worker.off("error", failed);
        worker.off("exit", exited);
      };
      const finish = (): void => {
        cleanup();
        if (this.active?.worker === worker) this.active = undefined;
        void worker.terminate();
      };
      const message = (value: unknown): void => {
        const response = value as LibraryQualityWorkerMessage;
        if (response.type === "progress") {
          onProgress?.(
            response.completed,
            response.total,
            `Checked ${response.completed} of ${response.total} albums.`,
          );
          return;
        }
        finish();
        if (response.type === "complete") resolve(response.page);
        else reject(new Error(response.error));
      };
      const failed = (error: Error): void => {
        finish();
        reject(error);
      };
      const exited = (code: number): void => {
        if (this.active?.worker !== worker) return;
        finish();
        reject(
          new Error(`Library data-quality worker exited with code ${code}.`),
        );
      };
      worker.on("message", message);
      worker.on("error", failed);
      worker.on("exit", exited);
      this.active = { worker, cleanup, reject };
    });
  }

  async cancel(): Promise<void> {
    this.generation++;
    await this.cancelActive();
  }

  private async cancelActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.cleanup();
    active.reject(cancelledError());
    await active.worker.terminate();
  }

  close(): Promise<void> {
    return this.cancel();
  }
}
