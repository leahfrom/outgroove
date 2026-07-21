import type {
  ScanDatabaseChangedPath,
  ScanDatabaseDiscoveryEntry,
  ScanDatabaseDiscoveryResult,
  ScanDatabaseFileEntry,
} from "../../shared/contracts/scan-database-worker";

export type Awaitable<T> = T | Promise<T>;

export interface ScanCatalog {
  beginScan(rootId: string): Awaitable<void>;
  recordScanDiscoveryBatch(
    rootId: string,
    entries: readonly ScanDatabaseDiscoveryEntry[],
  ): Awaitable<ScanDatabaseDiscoveryResult>;
  listChangedScanPaths(
    rootId: string,
    afterSequence: number,
    limit: number,
  ): Awaitable<readonly ScanDatabaseChangedPath[]>;
  upsertScannedFiles(
    rootId: string,
    files: readonly ScanDatabaseFileEntry[],
  ): Awaitable<void>;
  upsertScanError(
    rootId: string,
    path: string,
    pathKey: string,
    size: number,
    modifiedMs: number,
    message: string,
  ): Awaitable<void>;
  finishScan(rootId: string): Awaitable<void>;
  abandonScan(rootId: string): Awaitable<void>;
}
