import type { LibraryPageDto } from "./api";

export interface LibraryQualityWorkerRequest {
  readonly query: string;
  readonly offset: number;
  readonly limit: number;
}

export type LibraryQualityWorkerMessage =
  | {
      readonly type: "progress";
      readonly completed: number;
      readonly total: number;
    }
  | { readonly type: "complete"; readonly page: LibraryPageDto }
  | { readonly type: "error"; readonly error: string };
