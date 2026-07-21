import { z } from "zod";

import type { CatalogAlbum } from "../domain/catalog";
import type { AppError, Result } from "../domain/errors";

export const emptyRequestSchema = z.object({}).strict();
export const scanRequestSchema = z.object({ rootId: z.uuid() }).strict();
export const scanCancelRequestSchema = z.object({ jobId: z.uuid() }).strict();
export const albumEditPreviewRequestSchema = z
  .object({
    albumId: z.uuid(),
    proposedTitle: z.string().trim().min(1).max(400),
  })
  .strict();
export const albumEditApplyRequestSchema = z
  .object({ operationId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const syncProfileRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100), albumId: z.uuid() })
  .strict();
export const syncPlanRequestSchema = z.object({ profileId: z.uuid() }).strict();
export const syncApplyRequestSchema = z
  .object({ planId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();

export interface LibraryRootDto {
  readonly id: string;
  readonly path: string;
  readonly lastScanAt: string | null;
}
export interface ScanResultDto {
  readonly parsed: number;
  readonly unchanged: number;
  readonly errors: number;
}
export type ScanJobState =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";
export interface ScanJobDto {
  readonly id: string;
  readonly rootId: string;
  readonly state: ScanJobState;
  readonly completed: number;
  readonly total: number;
  readonly detail: string;
  readonly result: ScanResultDto | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}
export interface ScanErrorDto {
  readonly path: string;
  readonly message: string;
}
export interface TagEditFilePreviewDto {
  readonly fileId: string;
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly warnings: readonly string[];
}
export interface TagEditPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly files: readonly TagEditFilePreviewDto[];
}
export interface TagEditResultDto {
  readonly operationId: string;
  readonly results: readonly {
    fileId: string;
    path: string;
    verified: boolean;
    error: string | null;
  }[];
}

export interface SyncPlanItemDto {
  readonly sourceFileId: string;
  readonly sourcePath: string;
  readonly relativeDestination: string;
  readonly size: number;
  readonly signature: string;
}
export interface SyncPlanDto {
  readonly id: string;
  readonly profileId: string;
  readonly targetPath: string;
  readonly confirmationToken: string;
  readonly copies: readonly SyncPlanItemDto[];
  readonly unchanged: readonly SyncPlanItemDto[];
  readonly conflicts: readonly string[];
  readonly errors: readonly string[];
  readonly requiredBytes: number;
}
export interface SyncApplyResultDto {
  readonly copied: number;
  readonly unchanged: number;
  readonly playlistPath: string;
  readonly manifestPath: string;
  readonly errors: readonly string[];
}

export interface OutgrooveApi {
  chooseLibraryFolder(): Promise<Result<LibraryRootDto | null>>;
  listLibraryRoots(): Promise<Result<readonly LibraryRootDto[]>>;
  scanLibrary(
    request: z.infer<typeof scanRequestSchema>,
  ): Promise<Result<ScanJobDto>>;
  cancelScan(
    request: z.infer<typeof scanCancelRequestSchema>,
  ): Promise<Result<ScanJobDto>>;
  getLatestScanJob(): Promise<Result<ScanJobDto | null>>;
  listAlbums(): Promise<Result<readonly CatalogAlbum[]>>;
  listScanErrors(): Promise<Result<readonly ScanErrorDto[]>>;
  previewAlbumTitleEdit(
    request: z.infer<typeof albumEditPreviewRequestSchema>,
  ): Promise<Result<TagEditPreviewDto>>;
  applyAlbumTitleEdit(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  chooseSyncTargetAndCreateProfile(
    request: z.infer<typeof syncProfileRequestSchema>,
  ): Promise<Result<{ id: string; name: string; targetPath: string } | null>>;
  planSync(
    request: z.infer<typeof syncPlanRequestSchema>,
  ): Promise<Result<SyncPlanDto>>;
  applySync(
    request: z.infer<typeof syncApplyRequestSchema>,
  ): Promise<Result<SyncApplyResultDto>>;
  onJobProgress(
    listener: (progress: {
      job: "scan" | "tag-edit" | "sync";
      completed: number;
      total: number;
      detail: string;
    }) => void,
  ): () => void;
  onScanJobUpdated(listener: (job: ScanJobDto) => void): () => void;
}

export interface SerializableFailure extends AppError {
  readonly details?: readonly string[];
}
