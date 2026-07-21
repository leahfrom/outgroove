import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { EventEmitter } from "node:events";

import type {
  ScanDatabaseChangedPath,
  ScanDatabaseDiscoveryEntry,
  ScanDatabaseDiscoveryResult,
  ScanDatabaseFileEntry,
  ScanDatabaseWorkerRequest,
  ScanDatabaseWorkerResponse,
} from "../../../shared/contracts/scan-database-worker";
import type { ScanCatalog } from "../../application/scan-catalog";

export interface ScanDatabaseWorker extends EventEmitter {
  postMessage(message: ScanDatabaseWorkerRequest): void;
  terminate(): Promise<number>;
}

export type ScanDatabaseWorkerFactory = (
  workerPath: string,
  databasePath: string,
) => ScanDatabaseWorker;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

type ScanDatabaseWorkerCommand = ScanDatabaseWorkerRequest extends infer Request
  ? Request extends { readonly id: number }
    ? Omit<Request, "id">
    : never
  : never;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class WorkerScanCatalog implements ScanCatalog {
  private worker: ScanDatabaseWorker | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly activeRoots = new Set<string>();

  constructor(
    private readonly databasePath: string,
    private readonly workerPath = join(__dirname, "scan-database-worker.js"),
    private readonly createWorker: ScanDatabaseWorkerFactory = (
      path,
      catalogPath,
    ) => new Worker(path, { workerData: { databasePath: catalogPath } }),
  ) {}

  async beginScan(rootId: string): Promise<void> {
    if (this.activeRoots.has(rootId))
      throw new Error("A scan is already active for this library root.");
    this.activeRoots.add(rootId);
    try {
      await this.request({ operation: "begin", rootId });
    } catch (error) {
      this.activeRoots.delete(rootId);
      if (this.activeRoots.size === 0) await this.close();
      throw error;
    }
  }

  recordScanDiscoveryBatch(
    rootId: string,
    entries: readonly ScanDatabaseDiscoveryEntry[],
  ): Promise<ScanDatabaseDiscoveryResult> {
    return this.request({
      operation: "record-discovery",
      rootId,
      entries,
    }) as Promise<ScanDatabaseDiscoveryResult>;
  }

  listChangedScanPaths(
    rootId: string,
    afterSequence: number,
    limit: number,
  ): Promise<readonly ScanDatabaseChangedPath[]> {
    return this.request({
      operation: "list-changed",
      rootId,
      afterSequence,
      limit,
    }) as Promise<readonly ScanDatabaseChangedPath[]>;
  }

  upsertScannedFiles(
    rootId: string,
    files: readonly ScanDatabaseFileEntry[],
  ): Promise<void> {
    return this.request({ operation: "upsert-files", rootId, files }).then(
      () => undefined,
    );
  }

  upsertScanError(
    rootId: string,
    path: string,
    pathKey: string,
    size: number,
    modifiedMs: number,
    message: string,
  ): Promise<void> {
    return this.request({
      operation: "upsert-error",
      rootId,
      path,
      pathKey,
      size,
      modifiedMs,
      message,
    }).then(() => undefined);
  }

  async finishScan(rootId: string): Promise<void> {
    await this.request({ operation: "finish", rootId });
    this.activeRoots.delete(rootId);
    if (this.activeRoots.size === 0) await this.close();
  }

  async abandonScan(rootId: string): Promise<void> {
    if (!this.activeRoots.has(rootId)) return;
    try {
      await this.request({ operation: "abandon", rootId });
    } finally {
      this.activeRoots.delete(rootId);
      if (this.activeRoots.size === 0) await this.close();
    }
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.activeRoots.clear();
    if (!worker) return;
    this.failPending(new Error("Scan database worker closed."));
    await worker.terminate();
  }

  private request(request: ScanDatabaseWorkerCommand): Promise<unknown> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...request, id });
      } catch (error) {
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  private ensureWorker(): ScanDatabaseWorker {
    if (this.worker) return this.worker;
    const worker = this.createWorker(this.workerPath, this.databasePath);
    this.worker = worker;
    worker.on("message", (value: unknown) => {
      const response = value as ScanDatabaseWorkerResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    });
    worker.on("error", (error: Error) => this.workerFailed(worker, error));
    worker.on("exit", (code: number) => {
      if (this.worker === worker)
        this.workerFailed(
          worker,
          new Error(`Scan database worker exited with code ${code}.`),
        );
    });
    return worker;
  }

  private workerFailed(worker: ScanDatabaseWorker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.activeRoots.clear();
    this.failPending(error);
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
