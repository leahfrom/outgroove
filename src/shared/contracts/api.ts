import { z } from "zod";

import type { CatalogAlbum } from "../domain/catalog";
import type { AppError, Result } from "../domain/errors";
import { isValidPartialDate } from "../domain/tag-edit";
import type { EditableTrackTagField } from "../domain/tag-edit";

export const emptyRequestSchema = z.object({}).strict();
export const scanRequestSchema = z.object({ rootId: z.uuid() }).strict();
export const scanCancelRequestSchema = z.object({ jobId: z.uuid() }).strict();
export const libraryQueryRequestSchema = z
  .object({
    query: z.string().trim().max(200),
    view: z.enum(["albums", "scan-errors"]),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(50),
  })
  .strict();
export const albumEditPreviewRequestSchema = z
  .object({
    albumId: z.uuid(),
    proposedTitle: z.string().trim().min(1).max(400),
  })
  .strict();
export const albumEditApplyRequestSchema = z
  .object({ operationId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const albumEditHistoryRequestSchema = z
  .object({ albumId: z.uuid() })
  .strict();
export const albumEditUndoPreviewRequestSchema = z
  .object({ operationId: z.uuid() })
  .strict();
export const trackTagEditPreviewRequestSchema = z
  .object({
    fileId: z.uuid(),
    changes: z
      .object({
        title: z.string().trim().min(1).max(400).optional(),
        artist: z.string().trim().min(1).max(400).optional(),
        albumArtist: z.string().trim().min(1).max(400).optional(),
        trackNumber: z.number().int().min(1).max(9999).nullable().optional(),
        discNumber: z.number().int().min(1).max(999).nullable().optional(),
        year: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0),
  })
  .strict();
export const trackBatchEditPreviewRequestSchema = z
  .object({
    fileIds: z
      .array(z.uuid())
      .min(2)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Choose each track only once.",
      }),
    changes: z
      .object({
        artist: z.string().trim().min(1).max(400).optional(),
        albumArtist: z.string().trim().min(1).max(400).optional(),
        discNumber: z.number().int().min(1).max(999).nullable().optional(),
        year: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0),
  })
  .strict();
export const syncProfileRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100), albumId: z.uuid() })
  .strict();
export const syncPlanRequestSchema = z.object({ profileId: z.uuid() }).strict();
export const syncApplyRequestSchema = z
  .object({ planId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const databaseRestoreApplyRequestSchema = z
  .object({ operationId: z.uuid(), confirmationToken: z.string().min(20) })
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
  readonly kind: "file" | "directory";
  readonly path: string;
  readonly message: string;
}
export interface LibraryPageDto {
  readonly albums: readonly CatalogAlbum[];
  readonly scanErrors: readonly ScanErrorDto[];
  readonly totalItems: number;
  readonly offset: number;
  readonly limit: number;
}
export interface DatabaseBackupResultDto {
  readonly path: string;
}
export interface DatabaseRestorePreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly sourceName: string;
  readonly schemaVersion: number;
  readonly summary: {
    readonly libraryRoots: number;
    readonly albums: number;
    readonly tracks: number;
    readonly syncProfiles: number;
  };
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
export interface TrackTagEditPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly fileId: string;
  readonly path: string;
  readonly changes: readonly {
    field: EditableTrackTagField;
    before: string | number | null;
    after: string | number | null;
  }[];
  readonly warnings: readonly string[];
}
export interface TrackBatchEditPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly files: readonly (Omit<
    TrackTagEditPreviewDto,
    "operationId" | "confirmationToken"
  > & {
    readonly willWrite: boolean;
  })[];
}
export interface TagEditHistoryItemDto {
  readonly operationId: string;
  readonly kind:
    | "album-title-edit"
    | "album-title-undo"
    | "track-tags-edit"
    | "track-tags-undo"
    | "track-tags-batch-edit"
    | "track-tags-batch-undo";
  readonly sourceOperationId: string | null;
  readonly proposedTitle: string;
  readonly state: "completed" | "failed";
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly verifiedFiles: number;
  readonly failedFiles: number;
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
  createDatabaseBackup(): Promise<Result<DatabaseBackupResultDto | null>>;
  chooseDatabaseRestore(): Promise<Result<DatabaseRestorePreviewDto | null>>;
  applyDatabaseRestore(
    request: z.infer<typeof databaseRestoreApplyRequestSchema>,
  ): Promise<Result<{ rollbackBackupPath: string; restarting: true }>>;
  queryLibrary(
    request: z.infer<typeof libraryQueryRequestSchema>,
  ): Promise<Result<LibraryPageDto>>;
  previewAlbumTitleEdit(
    request: z.infer<typeof albumEditPreviewRequestSchema>,
  ): Promise<Result<TagEditPreviewDto>>;
  applyAlbumTitleEdit(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  listAlbumEditHistory(
    request: z.infer<typeof albumEditHistoryRequestSchema>,
  ): Promise<Result<readonly TagEditHistoryItemDto[]>>;
  previewAlbumTitleUndo(
    request: z.infer<typeof albumEditUndoPreviewRequestSchema>,
  ): Promise<Result<TagEditPreviewDto>>;
  applyAlbumTitleUndo(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  previewTrackTagEdit(
    request: z.infer<typeof trackTagEditPreviewRequestSchema>,
  ): Promise<Result<TrackTagEditPreviewDto>>;
  applyTrackTagEdit(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  previewTrackTagUndo(
    request: z.infer<typeof albumEditUndoPreviewRequestSchema>,
  ): Promise<Result<TrackTagEditPreviewDto>>;
  applyTrackTagUndo(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  previewTrackBatchEdit(
    request: z.infer<typeof trackBatchEditPreviewRequestSchema>,
  ): Promise<Result<TrackBatchEditPreviewDto>>;
  applyTrackBatchEdit(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  previewTrackBatchUndo(
    request: z.infer<typeof albumEditUndoPreviewRequestSchema>,
  ): Promise<Result<TrackBatchEditPreviewDto>>;
  applyTrackBatchUndo(
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
