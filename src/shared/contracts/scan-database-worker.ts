import type { ScannedAudioFile } from "../domain/catalog";

export type ScanDatabaseWorkerRequest =
  | {
      readonly id: number;
      readonly operation: "begin";
      readonly rootId: string;
    }
  | {
      readonly id: number;
      readonly operation: "record-discovery";
      readonly rootId: string;
      readonly entries: readonly ScanDatabaseDiscoveryEntry[];
    }
  | {
      readonly id: number;
      readonly operation: "list-changed";
      readonly rootId: string;
      readonly afterSequence: number;
      readonly limit: number;
    }
  | {
      readonly id: number;
      readonly operation: "upsert-files";
      readonly rootId: string;
      readonly files: readonly ScanDatabaseFileEntry[];
    }
  | {
      readonly id: number;
      readonly operation: "upsert-error";
      readonly rootId: string;
      readonly path: string;
      readonly pathKey: string;
      readonly size: number;
      readonly modifiedMs: number;
      readonly message: string;
    }
  | {
      readonly id: number;
      readonly operation: "finish";
      readonly rootId: string;
    }
  | {
      readonly id: number;
      readonly operation: "abandon";
      readonly rootId: string;
    };

export type ScanDatabaseDiscoveryEntry =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly pathKey: string;
      readonly size: number;
      readonly modifiedMs: number;
    }
  | {
      readonly kind: "file-error" | "directory-error";
      readonly path: string;
      readonly pathKey: string;
      readonly message: string;
    };

export interface ScanDatabaseFileEntry {
  readonly pathKey: string;
  readonly file: ScannedAudioFile;
}

export interface ScanDatabaseDiscoveryResult {
  readonly changed: number;
  readonly unchanged: number;
}

export interface ScanDatabaseChangedPath {
  readonly sequence: number;
  readonly path: string;
}

export type ScanDatabaseWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly result?: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };
