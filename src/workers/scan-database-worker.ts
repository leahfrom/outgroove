import { parentPort, workerData } from "node:worker_threads";

import type {
  ScanDatabaseWorkerRequest,
  ScanDatabaseWorkerResponse,
} from "../shared/contracts/scan-database-worker";
import { CatalogDatabase } from "../main/adapters/database/catalog-database";

const port = parentPort;
if (!port) throw new Error("Scan database worker requires a parent port.");

const databasePath = (workerData as { databasePath?: unknown }).databasePath;
if (typeof databasePath !== "string" || databasePath.length === 0)
  throw new Error("Scan database worker requires a database path.");

const database = new CatalogDatabase(databasePath, {
  interruptOrphanedJobs: false,
});

function handle(request: ScanDatabaseWorkerRequest): unknown {
  switch (request.operation) {
    case "begin":
      return database.beginScan(request.rootId);
    case "record-discovery":
      return database.recordScanDiscoveryBatch(request.rootId, request.entries);
    case "list-changed":
      return database.listChangedScanPaths(
        request.rootId,
        request.afterSequence,
        request.limit,
      );
    case "upsert-files":
      return database.upsertScannedFiles(request.rootId, request.files);
    case "upsert-error":
      return database.upsertScanError(
        request.rootId,
        request.path,
        request.pathKey,
        request.size,
        request.modifiedMs,
        request.message,
      );
    case "finish":
      return database.finishScan(request.rootId);
    case "abandon":
      return database.abandonScan(request.rootId, request.recoverSearch);
  }
}

port.on("message", (request: ScanDatabaseWorkerRequest) => {
  let response: ScanDatabaseWorkerResponse;
  try {
    response = { id: request.id, ok: true, result: handle(request) };
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(response);
});

process.on("exit", () => database.close());
