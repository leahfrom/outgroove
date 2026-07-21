export interface DiscoveredFile {
  readonly kind: "file";
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
}

export type LibraryDiscoveryItem =
  | DiscoveredFile
  | {
      readonly kind: "file-error";
      readonly path: string;
      readonly message: string;
    }
  | {
      readonly kind: "directory-error";
      readonly path: string;
      readonly message: string;
    };

export type LibraryDiscoveryWorkerRequest =
  | { readonly type: "start"; readonly root: string }
  | { readonly type: "ack"; readonly batchId: number };

export type LibraryDiscoveryWorkerResponse =
  | {
      readonly type: "batch";
      readonly batchId: number;
      readonly items: readonly LibraryDiscoveryItem[];
    }
  | { readonly type: "complete" }
  | { readonly type: "fatal"; readonly error: string };
