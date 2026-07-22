import { parentPort, workerData } from "node:worker_threads";

import type {
  LibraryQualityWorkerMessage,
  LibraryQualityWorkerRequest,
} from "../shared/contracts/library-quality-worker";
import type { CatalogAlbum } from "../shared/domain/catalog";
import {
  diagnoseAlbum,
  diagnosticMatchesFilter,
  isAlbumDiagnosticFilter,
} from "../shared/domain/album-diagnostics";
import { CatalogDatabase } from "../main/adapters/database/catalog-database";

const port = parentPort;
if (!port)
  throw new Error("Library data-quality worker requires a parent port.");
const workerPort = port;

const data = workerData as {
  databasePath?: unknown;
  request?: Partial<LibraryQualityWorkerRequest>;
};
if (typeof data.databasePath !== "string" || data.databasePath.length === 0)
  throw new Error("Library data-quality worker requires a database path.");
const rawRequest = data.request;
if (
  !rawRequest ||
  typeof rawRequest.query !== "string" ||
  typeof rawRequest.offset !== "number" ||
  !Number.isInteger(rawRequest.offset) ||
  rawRequest.offset < 0 ||
  typeof rawRequest.limit !== "number" ||
  !Number.isInteger(rawRequest.limit) ||
  rawRequest.limit < 1 ||
  rawRequest.limit > 50 ||
  !isAlbumDiagnosticFilter(rawRequest.qualityFilter)
)
  throw new Error("Library data-quality worker received an invalid request.");
const request: LibraryQualityWorkerRequest = {
  query: rawRequest.query,
  offset: rawRequest.offset,
  limit: rawRequest.limit,
  qualityFilter: rawRequest.qualityFilter,
};

const database = new CatalogDatabase(data.databasePath, {
  interruptOrphanedJobs: false,
});

function post(message: LibraryQualityWorkerMessage): void {
  workerPort.postMessage(message);
}

function runQuery(): LibraryQualityWorkerMessage {
  const albums: CatalogAlbum[] = [];
  let matchingAlbums = 0;
  let sourceOffset = 0;
  let sourceTotal = 0;
  do {
    const sourcePage = database.queryLibrary({
      query: request.query,
      view: "albums",
      offset: sourceOffset,
      limit: 50,
    });
    sourceTotal = sourcePage.totalItems;
    for (const album of sourcePage.albums) {
      if (
        !diagnoseAlbum(album).some((finding) =>
          diagnosticMatchesFilter(finding, request.qualityFilter),
        )
      )
        continue;
      if (matchingAlbums >= request.offset && albums.length < request.limit)
        albums.push(album);
      matchingAlbums++;
    }
    sourceOffset += sourcePage.albums.length;
    post({
      type: "progress",
      completed: sourceOffset,
      total: sourceTotal,
    });
    if (sourcePage.albums.length === 0) break;
  } while (sourceOffset < sourceTotal);

  return {
    type: "complete",
    page: {
      albums,
      artists: [],
      scanErrors: [],
      totalItems: matchingAlbums,
      offset: request.offset,
      limit: request.limit,
    },
  };
}

let response: LibraryQualityWorkerMessage;
try {
  response = runQuery();
} catch (error) {
  response = {
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  };
}
try {
  database.close();
} catch (error) {
  response = {
    type: "error",
    error: `Library data-quality database close failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}
post(response);
