import type { LibraryPageDto } from "./api";
import type { AlbumDiagnosticFilter } from "../domain/album-diagnostics";

export interface LibraryQualityWorkerRequest {
  readonly query: string;
  readonly offset: number;
  readonly limit: number;
  readonly qualityFilter: AlbumDiagnosticFilter;
}

export type LibraryQualityWorkerMessage =
  | {
      readonly type: "progress";
      readonly completed: number;
      readonly total: number;
    }
  | { readonly type: "complete"; readonly page: LibraryPageDto }
  | { readonly type: "error"; readonly error: string };
