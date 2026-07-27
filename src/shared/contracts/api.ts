import { z } from "zod";

import type { CatalogAlbum } from "../domain/catalog";
import type {
  ComparedAlbumCandidate,
  MusicBrainzReleaseTracklist,
} from "../domain/album-identification";
import { albumDiagnosticFilters } from "../domain/album-diagnostics";
import type { AppError, Result } from "../domain/errors";
import { isValidPartialDate } from "../domain/tag-edit";
import type { EditableTrackTagField } from "../domain/tag-edit";

const musicBrainzIdSchema = z
  .uuid()
  .transform((value) => value.toLocaleLowerCase("en-US"));
const musicBrainzIdListSchema = z.array(musicBrainzIdSchema).max(1);

export const emptyRequestSchema = z.object({}).strict();
export const scanRequestSchema = z.object({ rootId: z.uuid() }).strict();
export const scanCancelRequestSchema = z.object({ jobId: z.uuid() }).strict();
export const libraryRootRemovalPreviewRequestSchema = z
  .object({ rootId: z.uuid() })
  .strict();
export const libraryRootRemovalApplyRequestSchema = z
  .object({ operationId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const libraryViews = [
  "albums",
  "artists",
  "genres",
  "formats",
  "folders",
  "tracks",
  "data-quality",
  "scan-errors",
] as const;
export const libraryQueryRequestSchema = z
  .object({
    query: z.string().trim().max(200),
    view: z.enum(libraryViews),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(50),
    qualityFilter: z.enum(albumDiagnosticFilters).optional(),
    albumArtist: z.string().trim().min(1).max(400).optional(),
    albumId: z.uuid().optional(),
    format: z.string().trim().min(1).max(100).optional(),
    folderId: z.string().min(1).max(32_768).optional(),
    genre: z.string().trim().min(1).max(400).optional(),
    missingGenre: z.literal(true).optional(),
  })
  .strict()
  .refine(
    ({ view, albumArtist, albumId }) =>
      (albumArtist === undefined && albumId === undefined) || view === "albums",
    { message: "Album filters require Albums." },
  )
  .refine(({ view, format }) => format === undefined || view === "tracks", {
    path: ["format"],
    message: "Format filters require Tracks.",
  })
  .refine(({ view, folderId }) => folderId === undefined || view === "tracks", {
    path: ["folderId"],
    message: "Folder filters require Tracks.",
  })
  .refine(
    ({ view, genre, missingGenre }) =>
      (genre === undefined && missingGenre === undefined) || view === "tracks",
    { message: "Genre filters require Tracks." },
  )
  .refine(
    ({ genre, missingGenre }) =>
      genre === undefined || missingGenre === undefined,
    { message: "Choose either a genre or missing genre, not both." },
  );
export const albumArtworkRequestSchema = z
  .object({
    albumIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Choose each album only once.",
      }),
  })
  .strict();
export const albumIdentificationRequestSchema = z
  .object({ albumId: z.uuid() })
  .strict();
export const musicBrainzReleaseLookupRequestSchema = z
  .object({
    albumId: z.uuid(),
    releaseId: musicBrainzIdSchema,
  })
  .strict();
export const savedLibraryFilterDefinitionSchema = z
  .object({
    query: z.string().trim().max(200),
    view: z.enum(libraryViews),
    qualityFilter: z.enum(albumDiagnosticFilters).optional(),
    albumArtist: z.string().trim().min(1).max(400).optional(),
    format: z.string().trim().min(1).max(100).optional(),
    folder: z
      .object({
        id: z.string().min(1).max(32_768),
        path: z.string().min(1).max(32_768),
      })
      .strict()
      .optional(),
    genre: z
      .object({
        name: z.string().trim().min(1).max(400),
        missing: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    ({ view, qualityFilter }) =>
      qualityFilter === undefined || view === "data-quality",
    { message: "Quality filters require Albums needing review." },
  )
  .refine(
    ({ view, albumArtist }) => albumArtist === undefined || view === "albums",
    { message: "Album-artist filters require Albums." },
  )
  .refine(
    ({ view, format, folder, genre }) =>
      (format === undefined && folder === undefined && genre === undefined) ||
      view === "tracks",
    { message: "Track filters require Tracks." },
  )
  .refine(
    ({ format, folder, genre }) =>
      [format, folder, genre].filter((value) => value !== undefined).length <=
      1,
    { message: "A saved view can contain only one exact Track filter." },
  );
export const createSavedLibraryFilterRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    definition: savedLibraryFilterDefinitionSchema,
  })
  .strict();
export const updateSavedLibraryFilterRequestSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    definition: savedLibraryFilterDefinitionSchema,
  })
  .strict();
export const deleteSavedLibraryFilterRequestSchema = z
  .object({ id: z.uuid() })
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
export const albumArtworkEditPreviewRequestSchema = z
  .object({ albumId: z.uuid() })
  .strict();
export const albumArtworkExportPreviewRequestSchema = z
  .object({ albumId: z.uuid() })
  .strict();
export const albumFolderArtworkPreviewRequestSchema = z
  .object({ albumId: z.uuid() })
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
        trackTotal: z.number().int().min(1).max(9999).nullable().optional(),
        discNumber: z.number().int().min(1).max(999).nullable().optional(),
        discTotal: z.number().int().min(1).max(999).nullable().optional(),
        year: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
        genres: z.array(z.string().trim().min(1).max(100)).max(1).optional(),
        composers: z.array(z.string().trim().min(1).max(400)).max(1).optional(),
        conductors: z
          .array(z.string().trim().min(1).max(400))
          .max(1)
          .optional(),
        lyricists: z.array(z.string().trim().min(1).max(400)).max(1).optional(),
        isrcs: z.array(z.string().trim().min(1).max(100)).max(1).optional(),
        copyright: z.string().trim().max(1000).nullable().optional(),
        comment: z.string().trim().max(4000).nullable().optional(),
        originalReleaseDate: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
        language: z.string().trim().max(100).nullable().optional(),
        publishers: z
          .array(z.string().trim().min(1).max(400))
          .max(1)
          .optional(),
        descriptions: z
          .array(z.string().trim().min(1).max(4000))
          .max(1)
          .optional(),
        grouping: z.string().trim().max(1000).nullable().optional(),
        catalogNumbers: z
          .array(z.string().trim().min(1).max(200))
          .max(1)
          .optional(),
        publishingDate: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
        bpm: z.number().int().min(1).max(999).nullable().optional(),
        compilation: z.boolean().optional(),
        musicBrainzRecordingId: musicBrainzIdSchema.nullable().optional(),
        musicBrainzReleaseTrackId: musicBrainzIdSchema.nullable().optional(),
        musicBrainzReleaseId: musicBrainzIdSchema.nullable().optional(),
        musicBrainzArtistIds: musicBrainzIdListSchema.optional(),
        musicBrainzReleaseArtistIds: musicBrainzIdListSchema.optional(),
        musicBrainzReleaseGroupId: musicBrainzIdSchema.nullable().optional(),
        musicBrainzWorkId: musicBrainzIdSchema.nullable().optional(),
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
        trackTotal: z.number().int().min(1).max(9999).nullable().optional(),
        discNumber: z.number().int().min(1).max(999).nullable().optional(),
        discTotal: z.number().int().min(1).max(999).nullable().optional(),
        year: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
        genres: z.array(z.string().trim().min(1).max(100)).max(1).optional(),
        composers: z.array(z.string().trim().min(1).max(400)).max(1).optional(),
        conductors: z
          .array(z.string().trim().min(1).max(400))
          .max(1)
          .optional(),
        lyricists: z.array(z.string().trim().min(1).max(400)).max(1).optional(),
        isrcs: z.array(z.string().trim().min(1).max(100)).max(1).optional(),
        copyright: z.string().trim().max(1000).nullable().optional(),
        originalReleaseDate: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
        language: z.string().trim().max(100).nullable().optional(),
        publishers: z
          .array(z.string().trim().min(1).max(400))
          .max(1)
          .optional(),
        grouping: z.string().trim().max(1000).nullable().optional(),
        catalogNumbers: z
          .array(z.string().trim().min(1).max(200))
          .max(1)
          .optional(),
        publishingDate: z
          .string()
          .trim()
          .refine(isValidPartialDate)
          .nullable()
          .optional(),
        compilation: z.boolean().optional(),
        musicBrainzReleaseId: musicBrainzIdSchema.nullable().optional(),
        musicBrainzReleaseArtistIds: musicBrainzIdListSchema.optional(),
        musicBrainzReleaseGroupId: musicBrainzIdSchema.nullable().optional(),
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0),
  })
  .strict();
const musicBrainzMappedTrackChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(400).optional(),
    artist: z.string().trim().min(1).max(400).optional(),
    trackNumber: z.number().int().min(1).max(9999).optional(),
    trackTotal: z.number().int().min(1).max(9999).optional(),
    discNumber: z.number().int().min(1).max(999).optional(),
    discTotal: z.number().int().min(1).max(999).optional(),
    isrcs: z.array(z.string().trim().min(1).max(100)).max(1).optional(),
    musicBrainzRecordingId: musicBrainzIdSchema.optional(),
    musicBrainzReleaseTrackId: musicBrainzIdSchema.optional(),
    musicBrainzArtistIds: musicBrainzIdListSchema.optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0);
export const musicBrainzTrackMappingPreviewRequestSchema = z
  .object({
    albumId: z.uuid(),
    releaseId: musicBrainzIdSchema,
    edits: z
      .array(
        z
          .object({
            fileId: z.uuid(),
            releaseTrackId: musicBrainzIdSchema,
            changes: musicBrainzMappedTrackChangesSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    ({ edits }) =>
      new Set(edits.map((edit) => edit.fileId)).size === edits.length,
    { message: "Choose each Library track only once." },
  )
  .refine(
    ({ edits }) =>
      new Set(edits.map((edit) => edit.releaseTrackId)).size === edits.length,
    { message: "Choose each MusicBrainz track only once." },
  );
export type MusicBrainzTrackMappingPreviewRequest = z.infer<
  typeof musicBrainzTrackMappingPreviewRequestSchema
>;
export const trackNumberSequencePreviewRequestSchema = z
  .object({
    fileIds: z
      .array(z.uuid())
      .min(2)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Choose each track only once.",
      }),
    startNumber: z.number().int().min(1).max(9999),
    discNumber: z.number().int().min(1).max(999).optional(),
  })
  .strict()
  .refine(
    ({ fileIds, startNumber }) => startNumber + fileIds.length - 1 <= 9999,
    { message: "The resulting track number exceeds 9999." },
  );
const syncProfileAlbumIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Choose each album only once.",
  });
export const syncProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    albumIds: syncProfileAlbumIdsSchema,
  })
  .strict();
export const updateSyncProfileAlbumsRequestSchema = z
  .object({ id: z.uuid(), albumIds: syncProfileAlbumIdsSchema })
  .strict();
export const renameSyncProfileRequestSchema = z
  .object({ id: z.uuid(), name: z.string().trim().min(1).max(100) })
  .strict();
export const syncProfileTargetPreviewRequestSchema = z
  .object({ profileId: z.uuid() })
  .strict();
export const syncProfileTargetApplyRequestSchema = z
  .object({ operationId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const syncHistoryRequestSchema = z
  .object({ profileId: z.uuid() })
  .strict();
export const syncPlanRequestSchema = z.object({ profileId: z.uuid() }).strict();
export const syncApplyRequestSchema = z
  .object({ planId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const syncCancelRequestSchema = z.object({ planId: z.uuid() }).strict();
export const syncRecoveryApplyRequestSchema = z
  .object({ runId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();
export const syncRecoveryPreviewRequestSchema = z
  .object({ runId: z.uuid() })
  .strict();
export const databaseRestoreApplyRequestSchema = z
  .object({ operationId: z.uuid(), confirmationToken: z.string().min(20) })
  .strict();

export interface LibraryRootDto {
  readonly id: string;
  readonly path: string;
  readonly lastScanAt: string | null;
}
export interface LibraryRootRemovalPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly rootId: string;
  readonly path: string;
  readonly visibleTracks: number;
  readonly albumsHidden: number;
  readonly scanProblemsHidden: number;
}
export interface LibraryRootRemovalResultDto {
  readonly rootId: string;
  readonly visibleTracksHidden: number;
  readonly albumsHidden: number;
  readonly scanProblemsHidden: number;
  readonly audioFilesDeleted: 0;
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
export interface LibraryArtistDto {
  readonly name: string;
  readonly albumCount: number;
  readonly trackCount: number;
}
export interface LibraryFormatDto {
  readonly name: string;
  readonly trackCount: number;
}
export interface LibraryGenreDto {
  readonly name: string;
  readonly trackCount: number;
  readonly missing: boolean;
}
export interface LibraryFolderDto {
  readonly id: string;
  readonly path: string;
  readonly albumCount: number;
  readonly trackCount: number;
}
export interface LibraryTrackDto {
  readonly id: string;
  readonly albumId: string;
  readonly title: string;
  readonly artist: string;
  readonly albumTitle: string;
  readonly albumArtist: string;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly format: string;
  readonly durationSeconds: number | null;
  readonly codec: string | null;
  readonly bitrate: number | null;
  readonly sampleRate: number | null;
  readonly bitDepth: number | null;
  readonly channels: number | null;
  readonly size: number;
  readonly path: string;
}
export interface LibraryPageDto {
  readonly albums: readonly CatalogAlbum[];
  readonly artists: readonly LibraryArtistDto[];
  readonly formats: readonly LibraryFormatDto[];
  readonly genres?: readonly LibraryGenreDto[];
  readonly folders: readonly LibraryFolderDto[];
  readonly tracks: readonly LibraryTrackDto[];
  readonly scanErrors: readonly ScanErrorDto[];
  readonly totalItems: number;
  readonly offset: number;
  readonly limit: number;
}
export interface AlbumArtworkThumbnailDto {
  readonly albumId: string;
  readonly status: "available" | "missing" | "unsupported" | "invalid";
  readonly dataUrl?: string;
}
export type SavedLibraryFilterDefinition = z.infer<
  typeof savedLibraryFilterDefinitionSchema
>;
export interface SavedLibraryFilterDto {
  readonly id: string;
  readonly name: string;
  readonly definition: SavedLibraryFilterDefinition;
  readonly createdAt: string;
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
    readonly savedLibraryFilters: number;
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
export interface AlbumArtworkEditPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly action: "replace" | "remove" | "restore";
  readonly proposedArtworkDataUrl?: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly width?: number;
  readonly height?: number;
  readonly files: readonly {
    readonly fileId: string;
    readonly path: string;
    readonly currentFrontCovers: number;
    readonly preservedPictures: number;
    readonly willWrite: boolean;
    readonly warnings: readonly string[];
  }[];
}
export interface AlbumArtworkExportPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly artworkDataUrl: string;
  readonly source: "embedded" | "folder";
  readonly mimeType: "image/jpeg" | "image/png";
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly suggestedFileName: string;
}
export interface AlbumArtworkExportResultDto {
  readonly destinationPath: string;
  readonly byteLength: number;
  readonly sha256: string;
}
export interface AlbumFolderArtworkPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly artworkDataUrl: string;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly destinationPath: string;
}
export interface AlbumFolderArtworkResultDto {
  readonly albumId: string;
  readonly destinationPath: string;
  readonly byteLength: number;
  readonly sha256: string;
}
export interface TrackTagEditPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly fileId: string;
  readonly path: string;
  readonly changes: readonly {
    field: EditableTrackTagField;
    before: string | number | boolean | readonly string[] | null;
    after: string | number | boolean | readonly string[] | null;
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
    | "track-tags-batch-undo"
    | "track-number-sequence-edit"
    | "album-artwork-edit"
    | "album-artwork-undo";
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
export interface SyncProfileDto {
  readonly id: string;
  readonly name: string;
  readonly targetPath: string;
  readonly albumIds: readonly string[];
  readonly albums: readonly {
    readonly id: string;
    readonly title: string;
    readonly albumArtist: string;
  }[];
  readonly createdAt: string;
}
export interface SyncHistoryItemDto {
  readonly id: string;
  readonly profileId: string;
  readonly targetPath: string;
  readonly completedAt: string;
  readonly entryCount: number;
}
export interface SyncProfileTargetPreviewDto {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly currentTargetPath: string;
  readonly proposedTargetPath: string;
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
  readonly outcome: "completed" | "cancelled" | "failed";
  readonly copied: number;
  readonly rolledBack: number;
  readonly unchanged: number;
  readonly playlistPath: string;
  readonly manifestPath: string;
  readonly errors: readonly string[];
}
export interface SyncCancelResultDto {
  readonly planId: string;
  readonly accepted: boolean;
  readonly state: "cancelling" | "finalizing" | "not-running";
}
export interface SyncRecoveryPreviewDto {
  readonly runId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly targetPath: string;
  readonly interruptedAt: string;
  readonly phase: "copying" | "finalizing";
  readonly mode: "rollback" | "committed-cleanup";
  readonly actions: readonly {
    readonly path: string;
    readonly action: "remove" | "restore";
    readonly explanation: string;
  }[];
  readonly warnings: readonly string[];
  readonly canRecover: boolean;
  readonly confirmationToken: string;
}
export interface SyncRecoverySummaryDto {
  readonly runId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly targetPath: string;
  readonly interruptedAt: string;
  readonly phase: "copying" | "finalizing";
  readonly mode: "rollback" | "committed-cleanup";
}
export interface SyncRecoveryResultDto {
  readonly runId: string;
  readonly recovered: number;
  readonly errors: readonly string[];
  readonly complete: boolean;
}

export interface AlbumIdentificationResultDto {
  readonly albumId: string;
  readonly sent: {
    readonly albumTitle: string;
    readonly albumArtist: string;
  };
  readonly candidates: readonly ComparedAlbumCandidate[];
  readonly source: "network" | "cache" | "stale-cache";
  readonly fetchedAt: string;
  readonly readOnly: true;
}

export interface MusicBrainzReleaseTracklistDto {
  readonly albumId: string;
  readonly release: MusicBrainzReleaseTracklist;
  readonly source: "network" | "cache" | "stale-cache";
  readonly fetchedAt: string;
  readonly readOnly: true;
}

export interface OutgrooveApi {
  chooseLibraryFolder(): Promise<Result<LibraryRootDto | null>>;
  listLibraryRoots(): Promise<Result<readonly LibraryRootDto[]>>;
  previewLibraryRootRemoval(
    request: z.infer<typeof libraryRootRemovalPreviewRequestSchema>,
  ): Promise<Result<LibraryRootRemovalPreviewDto>>;
  applyLibraryRootRemoval(
    request: z.infer<typeof libraryRootRemovalApplyRequestSchema>,
  ): Promise<Result<LibraryRootRemovalResultDto>>;
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
  loadAlbumArtwork(
    request: z.infer<typeof albumArtworkRequestSchema>,
  ): Promise<Result<readonly AlbumArtworkThumbnailDto[]>>;
  findMusicBrainzAlbumCandidates(
    request: z.infer<typeof albumIdentificationRequestSchema>,
  ): Promise<Result<AlbumIdentificationResultDto>>;
  loadMusicBrainzReleaseTracks(
    request: z.infer<typeof musicBrainzReleaseLookupRequestSchema>,
  ): Promise<Result<MusicBrainzReleaseTracklistDto>>;
  cancelMusicBrainzAlbumCandidates(
    request: z.infer<typeof albumIdentificationRequestSchema>,
  ): Promise<Result<{ readonly cancelled: boolean }>>;
  listSavedLibraryFilters(): Promise<Result<readonly SavedLibraryFilterDto[]>>;
  createSavedLibraryFilter(
    request: z.infer<typeof createSavedLibraryFilterRequestSchema>,
  ): Promise<Result<SavedLibraryFilterDto>>;
  updateSavedLibraryFilter(
    request: z.infer<typeof updateSavedLibraryFilterRequestSchema>,
  ): Promise<Result<SavedLibraryFilterDto>>;
  deleteSavedLibraryFilter(
    request: z.infer<typeof deleteSavedLibraryFilterRequestSchema>,
  ): Promise<Result<{ id: string }>>;
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
  chooseAlbumArtworkEdit(
    request: z.infer<typeof albumArtworkEditPreviewRequestSchema>,
  ): Promise<Result<AlbumArtworkEditPreviewDto | null>>;
  previewAlbumArtworkRemoval(
    request: z.infer<typeof albumArtworkEditPreviewRequestSchema>,
  ): Promise<Result<AlbumArtworkEditPreviewDto>>;
  applyAlbumArtworkEdit(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  previewAlbumArtworkUndo(
    request: z.infer<typeof albumEditUndoPreviewRequestSchema>,
  ): Promise<Result<AlbumArtworkEditPreviewDto>>;
  applyAlbumArtworkUndo(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  previewAlbumArtworkExport(
    request: z.infer<typeof albumArtworkExportPreviewRequestSchema>,
  ): Promise<Result<AlbumArtworkExportPreviewDto>>;
  exportAlbumArtwork(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<AlbumArtworkExportResultDto | null>>;
  previewAlbumFolderArtwork(
    request: z.infer<typeof albumFolderArtworkPreviewRequestSchema>,
  ): Promise<Result<AlbumFolderArtworkPreviewDto>>;
  applyAlbumFolderArtwork(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<AlbumFolderArtworkResultDto>>;
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
  previewMusicBrainzTrackMapping(
    request: z.infer<typeof musicBrainzTrackMappingPreviewRequestSchema>,
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
  previewTrackNumberSequence(
    request: z.infer<typeof trackNumberSequencePreviewRequestSchema>,
  ): Promise<Result<TrackBatchEditPreviewDto>>;
  applyTrackNumberSequence(
    request: z.infer<typeof albumEditApplyRequestSchema>,
  ): Promise<Result<TagEditResultDto>>;
  chooseSyncTargetAndCreateProfile(
    request: z.infer<typeof syncProfileRequestSchema>,
  ): Promise<
    Result<{
      id: string;
      name: string;
      targetPath: string;
      albumIds: readonly string[];
    } | null>
  >;
  listSyncProfiles(): Promise<Result<readonly SyncProfileDto[]>>;
  updateSyncProfileAlbums(
    request: z.infer<typeof updateSyncProfileAlbumsRequestSchema>,
  ): Promise<Result<SyncProfileDto>>;
  renameSyncProfile(
    request: z.infer<typeof renameSyncProfileRequestSchema>,
  ): Promise<Result<SyncProfileDto>>;
  chooseSyncProfileTarget(
    request: z.infer<typeof syncProfileTargetPreviewRequestSchema>,
  ): Promise<Result<SyncProfileTargetPreviewDto | null>>;
  applySyncProfileTarget(
    request: z.infer<typeof syncProfileTargetApplyRequestSchema>,
  ): Promise<Result<SyncProfileDto>>;
  listSyncHistory(
    request: z.infer<typeof syncHistoryRequestSchema>,
  ): Promise<Result<readonly SyncHistoryItemDto[]>>;
  planSync(
    request: z.infer<typeof syncPlanRequestSchema>,
  ): Promise<Result<SyncPlanDto>>;
  applySync(
    request: z.infer<typeof syncApplyRequestSchema>,
  ): Promise<Result<SyncApplyResultDto>>;
  cancelSync(
    request: z.infer<typeof syncCancelRequestSchema>,
  ): Promise<Result<SyncCancelResultDto>>;
  listSyncRecoveries(): Promise<Result<readonly SyncRecoverySummaryDto[]>>;
  previewSyncRecovery(
    request: z.infer<typeof syncRecoveryPreviewRequestSchema>,
  ): Promise<Result<SyncRecoveryPreviewDto>>;
  applySyncRecovery(
    request: z.infer<typeof syncRecoveryApplyRequestSchema>,
  ): Promise<Result<SyncRecoveryResultDto>>;
  onJobProgress(
    listener: (progress: {
      job: "scan" | "tag-edit" | "sync" | "library-quality";
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
