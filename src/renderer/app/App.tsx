import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AlbumArtworkEditPreviewDto,
  AlbumIdentificationResultDto,
  AcoustIdTrackLookupResultDto,
  AcoustIdTrackPreviewDto,
  AlbumArtworkExportPreviewDto,
  AlbumArtworkExportResultDto,
  AlbumArtworkThumbnailDto,
  AlbumFolderArtworkPreviewDto,
  AlbumFolderArtworkResultDto,
  CoverArtArchiveResultDto,
  DatabaseRestorePreviewDto,
  FavoriteArtistDto,
  FavoriteArtistSearchResultDto,
  RadarBackgroundRefreshSettingsDto,
  LibraryArtistDto,
  LibraryFormatDto,
  LibraryFolderDto,
  LibraryGenreDto,
  LibraryRootDto,
  LibraryRootRemovalPreviewDto,
  LibraryTrackDto,
  MusicBrainzReleaseTracklistDto,
  RadarItemDto,
  RadarReviewSummaryDto,
  RadarRefreshAllResultDto,
  RadarRefreshResultDto,
  SavedLibraryFilterDefinition,
  SavedLibraryFilterDto,
  ScanErrorDto,
  ScanJobDto,
  SyncHistoryItemDto,
  SyncRecoveryPreviewDto,
  SyncRecoverySummaryDto,
  SyncPlanDto,
  SyncProfileDto,
  SyncProfileRemovalPreviewDto,
  SyncProfileTargetPreviewDto,
  TagEditResultDto,
  TagEditHistoryItemDto,
  TagEditPreviewDto,
  TrackBatchEditPreviewDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import { radarViews } from "../../shared/contracts/api";
import type { RadarPrimaryTypeFilter } from "../../shared/domain/radar";
import {
  summarizeAlbumReleaseDate,
  type CatalogAlbum,
} from "../../shared/domain/catalog";
import {
  formatBitDepth,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
} from "../../shared/domain/audio-technical";
import {
  albumDiagnosticFilters,
  diagnoseAlbum,
  isAlbumDiagnosticFilter,
  type AlbumDiagnostic,
  type AlbumDiagnosticFilter,
  type AlbumDiagnosticWorkflow,
} from "../../shared/domain/album-diagnostics";
import {
  createAlbumCandidateTagDraft,
  type ComparedAlbumCandidate,
} from "../../shared/domain/album-identification";
import { ActivityView, type ActivityProgress } from "./activity-view";
import { AlbumActionsMenu } from "./album-actions-menu";
import { AlbumIdentification } from "./album-identification";
import { AlbumArtworkEditor } from "./album-artwork-editor";
import {
  AlbumTitleWorkbench,
  type AlbumTitleSection,
  type BatchUndoKind,
} from "./album-title-workbench";
import {
  ApplicationShell,
  type AppNotice,
  type AppView,
  type NoticeTone,
} from "./application-shell";
import {
  AlbumArtwork,
  LibraryAlbumCollection,
} from "./library-album-collection";
import {
  LibraryAlbumEditingNavigation,
  type LibraryAlbumEditingTool,
} from "./library-album-editing-navigation";
import { LibraryOnboarding } from "./library-onboarding";
import { LibraryTrackDetail } from "./library-track-detail";
import { ModalSheet } from "./modal-sheet";
import { RadarView } from "./radar-view";
import type { MusicBrainzTrackMappingEdit } from "./musicbrainz-track-mapper";
import {
  SharedFieldEditor,
  type SharedFieldDraft,
  type SharedFieldEnabled,
} from "./shared-field-editor";
import {
  TrackMetadataEditor,
  type TrackMetadataDraft,
} from "./track-metadata-editor";
import { TrackAcoustIdIdentification } from "./track-acoustid-identification";
import { TrackTechnicalInfo } from "./track-technical-info";
import { TrackOrderEditor } from "./track-order-editor";
import { SyncNavigation, type SyncStage } from "./sync-navigation";
import { SyncPlanReview } from "./sync-plan-review";
import {
  SyncRecoveryWorkspace,
  type SyncRecoveryFeedback,
} from "./sync-recovery-workspace";
import {
  SyncSetupWorkspace,
  type SyncSetupSection,
} from "./sync-setup-workspace";
import type { SettingsSection } from "./settings-navigation";
import { SettingsView } from "./settings-view";
import { WorkbenchTrackContext } from "./workbench-track-context";

type RadarReleaseView = (typeof radarViews)[number];
const radarPageLimit = 20;

const PAGE_SIZE = 20;
const inspectionSessionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function packagedInspectionSessionId(): string | undefined {
  const value = new URLSearchParams(window.location.search).get(
    "outgrooveInspection",
  );
  return value && inspectionSessionPattern.test(value) ? value : undefined;
}

function draftForTrack(track: CatalogAlbum["tracks"][number]) {
  return {
    title: track.tags.title,
    artist: track.tags.artist,
    albumArtist: track.tags.albumArtist,
    trackNumber: track.tags.trackNumber?.toString() ?? "",
    trackTotal: track.tags.trackTotal?.toString() ?? "",
    discNumber: track.tags.discNumber?.toString() ?? "",
    discTotal: track.tags.discTotal?.toString() ?? "",
    year: track.tags.year ?? "",
    genre: (track.tags.genres ?? []).join(" · "),
    composer: (track.tags.composers ?? []).join(" · "),
    conductor: (track.tags.conductors ?? []).join(" · "),
    lyricist: (track.tags.lyricists ?? []).join(" · "),
    isrc: (track.tags.isrcs ?? []).join(" · "),
    copyright: track.tags.copyright ?? "",
    originalReleaseDate: track.tags.originalReleaseDate ?? "",
    language: track.tags.language ?? "",
    comment: track.tags.comment ?? "",
    publisher: (track.tags.publishers ?? []).join(" · "),
    description: (track.tags.descriptions ?? []).join(" · "),
    grouping: track.tags.grouping ?? "",
    catalogNumber: (track.tags.catalogNumbers ?? []).join(" · "),
    publishingDate: track.tags.publishingDate ?? "",
    bpm: track.tags.bpm?.toString() ?? "",
    compilation: track.tags.compilation === true ? "true" : "false",
    musicBrainzRecordingId: track.tags.musicBrainzRecordingId ?? "",
    musicBrainzReleaseTrackId: track.tags.musicBrainzReleaseTrackId ?? "",
    musicBrainzReleaseId: track.tags.musicBrainzReleaseId ?? "",
    musicBrainzArtistId: (track.tags.musicBrainzArtistIds ?? []).join(" · "),
    musicBrainzReleaseArtistId: (
      track.tags.musicBrainzReleaseArtistIds ?? []
    ).join(" · "),
    musicBrainzReleaseGroupId: track.tags.musicBrainzReleaseGroupId ?? "",
    musicBrainzWorkId: track.tags.musicBrainzWorkId ?? "",
  };
}

const diagnosticFilterLabels: Record<AlbumDiagnosticFilter, string> = {
  all: "All findings",
  numbering: "Numbering",
  consistency: "Artist/date consistency",
  "missing-tags": "Missing/placeholder tags",
};

const libraryViewLabels: Record<SavedLibraryFilterDefinition["view"], string> =
  {
    albums: "Albums",
    artists: "Album artists",
    genres: "Genres",
    formats: "Formats",
    folders: "Folders",
    tracks: "Tracks",
    "data-quality": "Albums needing review",
    "scan-errors": "Scan problems",
  };

function describeSavedFilter(definition: SavedLibraryFilterDefinition): string {
  const parts = [libraryViewLabels[definition.view]];
  if (definition.query) parts.push(`search “${definition.query}”`);
  if (definition.qualityFilter)
    parts.push(diagnosticFilterLabels[definition.qualityFilter]);
  if (definition.albumArtist)
    parts.push(`album artist “${definition.albumArtist}”`);
  if (definition.format) parts.push(`format “${definition.format}”`);
  if (definition.folder) parts.push(`folder “${definition.folder.path}”`);
  if (definition.genre)
    parts.push(
      definition.genre.missing
        ? "no genre tag"
        : `genre “${definition.genre.name}”`,
    );
  return parts.join(" · ");
}

function diagnosticActionLabel(workflow: AlbumDiagnosticWorkflow): string {
  switch (workflow) {
    case "track-editor":
      return "Open affected track in the single-track editor";
    case "sequence":
      return "Select affected tracks for sequencing";
    case "batch-track-artist":
      return "Select affected tracks for track artist review";
    case "batch-album-artist":
      return "Select affected tracks for album artist review";
    case "batch-release-date":
      return "Select affected tracks for release date review";
    case "album-title":
      return "Open the album title editor";
  }
}

export function App(): React.JSX.Element {
  const inspectionSessionId = useMemo(packagedInspectionSessionId, []);
  const [activeView, setActiveView] = useState<AppView>("library");
  const [syncStage, setSyncStage] = useState<SyncStage>("setup");
  const [syncSetupSection, setSyncSetupSection] =
    useState<SyncSetupSection>("selection");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("library-folders");
  const [rootId, setRootId] = useState<string>();
  const [libraryRoots, setLibraryRoots] = useState<readonly LibraryRootDto[]>(
    [],
  );
  const [libraryRootsLoaded, setLibraryRootsLoaded] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [librarySetupError, setLibrarySetupError] = useState<string>();
  const [albums, setAlbums] = useState<readonly CatalogAlbum[]>([]);
  const [artworkByAlbum, setArtworkByAlbum] = useState<
    ReadonlyMap<string, AlbumArtworkThumbnailDto | "loading">
  >(new Map());
  const [artists, setArtists] = useState<readonly LibraryArtistDto[]>([]);
  const [genres, setGenres] = useState<readonly LibraryGenreDto[]>([]);
  const [formats, setFormats] = useState<readonly LibraryFormatDto[]>([]);
  const [folders, setFolders] = useState<readonly LibraryFolderDto[]>([]);
  const [tracks, setTracks] = useState<readonly LibraryTrackDto[]>([]);
  const [scanErrors, setScanErrors] = useState<readonly ScanErrorDto[]>([]);
  const [savedFilters, setSavedFilters] = useState<
    readonly SavedLibraryFilterDto[]
  >([]);
  const [savedFilterName, setSavedFilterName] = useState("");
  const [savedFilterNames, setSavedFilterNames] = useState<
    Record<string, string>
  >({});
  const [savedFilterBusy, setSavedFilterBusy] = useState(false);
  const [favoriteArtists, setFavoriteArtists] = useState<
    readonly FavoriteArtistDto[]
  >([]);
  const [allFavoriteArtists, setAllFavoriteArtists] = useState<
    readonly FavoriteArtistDto[]
  >([]);
  const [favoriteArtistIds, setFavoriteArtistIds] = useState<readonly string[]>(
    [],
  );
  const [favoriteFilterText, setFavoriteFilterText] = useState("");
  const [favoriteFilter, setFavoriteFilter] = useState("");
  const [artistSearchText, setArtistSearchText] = useState("");
  const [artistSearchLoading, setArtistSearchLoading] = useState(false);
  const [artistSearchResult, setArtistSearchResult] =
    useState<FavoriteArtistSearchResultDto>();
  const [artistSearchError, setArtistSearchError] = useState<string>();
  const [favoriteMutationBusy, setFavoriteMutationBusy] = useState(false);
  const [favoriteRemoval, setFavoriteRemoval] = useState<FavoriteArtistDto>();
  const [radarItems, setRadarItems] = useState<readonly RadarItemDto[]>([]);
  const [radarTotalItems, setRadarTotalItems] = useState(0);
  const [radarSummary, setRadarSummary] = useState<RadarReviewSummaryDto>({
    current: 0,
    unseen: 0,
    upcoming: 0,
    recent: 0,
    newlyFound: 0,
  });
  const [radarOffset, setRadarOffset] = useState(0);
  const [radarView, setRadarView] = useState<RadarReleaseView>("all");
  const [radarPrimaryType, setRadarPrimaryType] =
    useState<RadarPrimaryTypeFilter>("all");
  const [radarFavoriteArtistId, setRadarFavoriteArtistId] = useState<
    string | null
  >(null);
  const [radarUnseenOnly, setRadarUnseenOnly] = useState(false);
  const [radarIncludeDismissed, setRadarIncludeDismissed] = useState(false);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState<string>();
  const [radarRefreshResult, setRadarRefreshResult] =
    useState<RadarRefreshResultDto>();
  const [radarRefreshAllResult, setRadarRefreshAllResult] =
    useState<RadarRefreshAllResultDto>();
  const [radarRefreshAllActive, setRadarRefreshAllActive] = useState(false);
  const [radarRefreshAllCancelling, setRadarRefreshAllCancelling] =
    useState(false);
  const [refreshingFavoriteId, setRefreshingFavoriteId] = useState<string>();
  const [radarActionBusyId, setRadarActionBusyId] = useState<string>();
  const [radarBackgroundSettings, setRadarBackgroundSettings] =
    useState<RadarBackgroundRefreshSettingsDto>();
  const [radarBackgroundBusy, setRadarBackgroundBusy] = useState(false);
  const [radarBackgroundError, setRadarBackgroundError] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [libraryView, setLibraryView] = useState<
    | "albums"
    | "artists"
    | "genres"
    | "formats"
    | "folders"
    | "tracks"
    | "data-quality"
    | "scan-errors"
  >("albums");
  const [albumArtistFilter, setAlbumArtistFilter] = useState<string>();
  const [albumIdFilter, setAlbumIdFilter] = useState<string>();
  const [trackRouteLabel, setTrackRouteLabel] = useState<string>();
  const [pendingTrackId, setPendingTrackId] = useState<string>();
  const [trackFormatFilter, setTrackFormatFilter] = useState<string>();
  const [trackFolderFilter, setTrackFolderFilter] =
    useState<Pick<LibraryFolderDto, "id" | "path">>();
  const [trackGenreFilter, setTrackGenreFilter] =
    useState<Pick<LibraryGenreDto, "name" | "missing">>();
  const [qualityFilter, setQualityFilter] =
    useState<AlbumDiagnosticFilter>("all");
  const [pageOffset, setPageOffset] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [restorePreview, setRestorePreview] =
    useState<DatabaseRestorePreviewDto>();
  const [rootRemovalPreview, setRootRemovalPreview] =
    useState<LibraryRootRemovalPreviewDto>();
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>();
  const [libraryAlbumDetailOpen, setLibraryAlbumDetailOpen] = useState(false);
  const [libraryAlbumEditingTool, setLibraryAlbumEditingTool] =
    useState<LibraryAlbumEditingTool>();
  const [albumIdentificationOpen, setAlbumIdentificationOpen] = useState(false);
  const [albumIdentificationLoading, setAlbumIdentificationLoading] =
    useState(false);
  const [albumIdentificationResult, setAlbumIdentificationResult] =
    useState<AlbumIdentificationResultDto>();
  const [albumIdentificationError, setAlbumIdentificationError] =
    useState<string>();
  const [releaseTracksLoading, setReleaseTracksLoading] = useState(false);
  const [releaseTracksReleaseId, setReleaseTracksReleaseId] =
    useState<string>();
  const [releaseTracksResult, setReleaseTracksResult] =
    useState<MusicBrainzReleaseTracklistDto>();
  const [releaseTracksError, setReleaseTracksError] = useState<string>();
  const [coverArtLoading, setCoverArtLoading] = useState(false);
  const [coverArtReleaseId, setCoverArtReleaseId] = useState<string>();
  const [coverArtResult, setCoverArtResult] =
    useState<CoverArtArchiveResultDto>();
  const [coverArtError, setCoverArtError] = useState<string>();
  const [coverArtPreparing, setCoverArtPreparing] = useState(false);
  const [coverArtPrepareError, setCoverArtPrepareError] = useState<string>();
  const [musicBrainzMappingPreview, setMusicBrainzMappingPreview] =
    useState<TrackBatchEditPreviewDto>();
  const [musicBrainzMappingResult, setMusicBrainzMappingResult] =
    useState<TagEditResultDto>();
  const [musicBrainzMappingError, setMusicBrainzMappingError] =
    useState<string>();
  const [albumTitleSection, setAlbumTitleSection] =
    useState<AlbumTitleSection>("edit");
  const [editTitle, setEditTitle] = useState("");
  const [editPreview, setEditPreview] = useState<TagEditPreviewDto>();
  const [editResult, setEditResult] = useState<TagEditResultDto>();
  const [editError, setEditError] = useState<string>();
  const [editHistory, setEditHistory] = useState<
    readonly TagEditHistoryItemDto[]
  >([]);
  const [undoPreview, setUndoPreview] = useState<TagEditPreviewDto>();
  const [undoResult, setUndoResult] = useState<TagEditResultDto>();
  const [artworkEditPreview, setArtworkEditPreview] =
    useState<AlbumArtworkEditPreviewDto>();
  const [artworkEditResult, setArtworkEditResult] =
    useState<TagEditResultDto>();
  const [artworkEditResultAction, setArtworkEditResultAction] = useState<
    "remove" | "replace"
  >();
  const [artworkEditError, setArtworkEditError] = useState<string>();
  const [artworkExportPreview, setArtworkExportPreview] =
    useState<AlbumArtworkExportPreviewDto>();
  const [artworkExportResult, setArtworkExportResult] =
    useState<AlbumArtworkExportResultDto>();
  const [artworkExportError, setArtworkExportError] = useState<string>();
  const [folderArtworkPreview, setFolderArtworkPreview] =
    useState<AlbumFolderArtworkPreviewDto>();
  const [folderArtworkResult, setFolderArtworkResult] =
    useState<AlbumFolderArtworkResultDto>();
  const [folderArtworkError, setFolderArtworkError] = useState<string>();
  const [artworkUndoPreview, setArtworkUndoPreview] =
    useState<AlbumArtworkEditPreviewDto>();
  const [artworkUndoResult, setArtworkUndoResult] =
    useState<TagEditResultDto>();
  const [historyError, setHistoryError] = useState<string>();
  const [selectedTrackId, setSelectedTrackId] = useState<string>();
  const [libraryTrackEditorOpen, setLibraryTrackEditorOpen] = useState(false);
  const [technicalTrackId, setTechnicalTrackId] = useState<string>();
  const [acoustIdPreview, setAcoustIdPreview] =
    useState<AcoustIdTrackPreviewDto>();
  const [acoustIdResult, setAcoustIdResult] =
    useState<AcoustIdTrackLookupResultDto>();
  const [acoustIdError, setAcoustIdError] = useState<string>();
  const [acoustIdBusy, setAcoustIdBusy] = useState(false);
  const [trackDraft, setTrackDraft] = useState<TrackMetadataDraft>({
    title: "",
    artist: "",
    albumArtist: "",
    trackNumber: "",
    trackTotal: "",
    discNumber: "",
    discTotal: "",
    year: "",
    genre: "",
    composer: "",
    conductor: "",
    lyricist: "",
    isrc: "",
    copyright: "",
    originalReleaseDate: "",
    language: "",
    comment: "",
    publisher: "",
    description: "",
    grouping: "",
    catalogNumber: "",
    publishingDate: "",
    bpm: "",
    compilation: "false",
    musicBrainzRecordingId: "",
    musicBrainzReleaseTrackId: "",
    musicBrainzReleaseId: "",
    musicBrainzArtistId: "",
    musicBrainzReleaseArtistId: "",
    musicBrainzReleaseGroupId: "",
    musicBrainzWorkId: "",
  });
  const [trackEditPreview, setTrackEditPreview] =
    useState<TrackTagEditPreviewDto>();
  const [trackEditResult, setTrackEditResult] = useState<TagEditResultDto>();
  const [trackEditError, setTrackEditError] = useState<string>();
  const [trackUndoPreview, setTrackUndoPreview] =
    useState<TrackTagEditPreviewDto>();
  const [trackUndoResult, setTrackUndoResult] = useState<TagEditResultDto>();
  const [batchTrackIds, setBatchTrackIds] = useState<string[]>([]);
  const [metadataDraftSource, setMetadataDraftSource] = useState<string>();
  const [batchEnabled, setBatchEnabled] = useState<SharedFieldEnabled>({
    artist: false,
    albumArtist: false,
    trackTotal: false,
    discNumber: false,
    discTotal: false,
    year: false,
    genre: false,
    composer: false,
    conductor: false,
    lyricist: false,
    isrc: false,
    copyright: false,
    originalReleaseDate: false,
    language: false,
    publisher: false,
    grouping: false,
    catalogNumber: false,
    publishingDate: false,
    compilation: false,
    musicBrainzReleaseId: false,
    musicBrainzReleaseArtistId: false,
    musicBrainzReleaseGroupId: false,
  });
  const [batchDraft, setBatchDraft] = useState<SharedFieldDraft>({
    artist: "",
    albumArtist: "",
    trackTotal: "",
    discNumber: "",
    discTotal: "",
    year: "",
    genre: "",
    composer: "",
    conductor: "",
    lyricist: "",
    isrc: "",
    copyright: "",
    originalReleaseDate: "",
    language: "",
    publisher: "",
    grouping: "",
    catalogNumber: "",
    publishingDate: "",
    compilation: "false",
    musicBrainzReleaseId: "",
    musicBrainzReleaseArtistId: "",
    musicBrainzReleaseGroupId: "",
  });
  const [batchPreview, setBatchPreview] = useState<TrackBatchEditPreviewDto>();
  const [batchResult, setBatchResult] = useState<TagEditResultDto>();
  const [batchError, setBatchError] = useState<string>();
  const [sequenceStart, setSequenceStart] = useState("1");
  const [sequenceDiscEnabled, setSequenceDiscEnabled] = useState(false);
  const [sequenceDiscNumber, setSequenceDiscNumber] = useState("1");
  const [sequencePreview, setSequencePreview] =
    useState<TrackBatchEditPreviewDto>();
  const [sequenceResult, setSequenceResult] = useState<TagEditResultDto>();
  const [sequenceError, setSequenceError] = useState<string>();
  const [batchUndoPreview, setBatchUndoPreview] =
    useState<TrackBatchEditPreviewDto>();
  const [batchUndoResult, setBatchUndoResult] = useState<TagEditResultDto>();
  const [batchUndoKind, setBatchUndoKind] =
    useState<BatchUndoKind>("shared-fields");
  const [syncAlbums, setSyncAlbums] = useState<
    readonly Pick<CatalogAlbum, "id" | "title" | "albumArtist">[]
  >([]);
  const [syncProfiles, setSyncProfiles] = useState<readonly SyncProfileDto[]>(
    [],
  );
  const [editingSyncProfileId, setEditingSyncProfileId] = useState<string>();
  const [renamingSyncProfileId, setRenamingSyncProfileId] = useState<string>();
  const [syncProfileNameDraft, setSyncProfileNameDraft] = useState("");
  const [syncHistory, setSyncHistory] = useState<readonly SyncHistoryItemDto[]>(
    [],
  );
  const [syncHistoryProfileId, setSyncHistoryProfileId] = useState<string>();
  const [syncHistoryLoading, setSyncHistoryLoading] = useState(false);
  const [syncRecoveries, setSyncRecoveries] = useState<
    readonly SyncRecoverySummaryDto[]
  >([]);
  const [syncRecoveryPreview, setSyncRecoveryPreview] =
    useState<SyncRecoveryPreviewDto>();
  const [
    syncRecoveryTargetVolumeConfirmed,
    setSyncRecoveryTargetVolumeConfirmed,
  ] = useState(false);
  const [syncRecoveryFeedback, setSyncRecoveryFeedback] =
    useState<SyncRecoveryFeedback>();
  const [syncTargetPreview, setSyncTargetPreview] =
    useState<SyncProfileTargetPreviewDto>();
  const [syncProfileRemovalPreview, setSyncProfileRemovalPreview] =
    useState<SyncProfileRemovalPreviewDto>();
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    targetPath: string;
    albumIds: readonly string[];
  }>();
  const [syncPlan, setSyncPlan] = useState<SyncPlanDto>();
  const [syncCleanupEnabled, setSyncCleanupEnabled] = useState(false);
  const [syncTargetVolumeConfirmed, setSyncTargetVolumeConfirmed] =
    useState(false);
  const [syncApplyingPlanId, setSyncApplyingPlanId] = useState<string>();
  const [syncCancellationRequested, setSyncCancellationRequested] =
    useState(false);
  const [progress, setProgress] = useState<ActivityProgress>();
  const [scanJob, setScanJob] = useState<ScanJobDto>();
  const [notice, setNoticeState] = useState<AppNotice>();
  const setNotice = useCallback(
    (message: string, tone: NoticeTone = "info"): void => {
      setNoticeState(message ? { message, tone } : undefined);
    },
    [],
  );
  const [busy, setBusy] = useState(false);
  const [diagnosticDestination, setDiagnosticDestination] = useState<{
    target: "track" | "batch" | "sequence" | "album-title";
    request: number;
  }>();
  const trackEditorRef = useRef<HTMLElement>(null);
  const batchEditorRef = useRef<HTMLElement>(null);
  const sequenceEditorRef = useRef<HTMLElement>(null);
  const albumTitleEditorRef = useRef<HTMLElement>(null);
  const syncPlanHeadingRef = useRef<HTMLHeadingElement>(null);
  const syncTargetPreviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const syncProfileRemovalPreviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const syncRecoveryPreviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const syncRecoveryFeedbackHeadingRef = useRef<HTMLHeadingElement>(null);
  const albumDetailHeadingRef = useRef<HTMLHeadingElement>(null);
  const albumDetailFocusPending = useRef(false);
  const albumTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const trackEditTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const trackEditorReturnFocusId = useRef<string | undefined>(undefined);
  const trackEditorReturnFocusElement = useRef<HTMLElement | undefined>(
    undefined,
  );
  const albumReturnFocusId = useRef<string | undefined>(undefined);
  const albumCollectionScrollPosition = useRef({ left: 0, top: 0 });
  const albumCollectionScrollRestorePending = useRef(false);
  const albumPointerForwardId = useRef<string | undefined>(undefined);
  const libraryRequestId = useRef(0);
  const artistSearchRequestId = useRef(0);
  const albumIdentificationRequestId = useRef(0);
  const coverArtRequestId = useRef(0);
  const acoustIdRequestId = useRef(0);
  const syncHistoryRequestId = useRef(0);
  const scanActive =
    scanJob?.state === "queued" ||
    scanJob?.state === "running" ||
    scanJob?.state === "cancelling";
  const selectedAlbum = useMemo(
    () => albums.find((album) => album.id === selectedAlbumId),
    [albums, selectedAlbumId],
  );
  const selectedTrack = useMemo(
    () => selectedAlbum?.tracks.find((track) => track.id === selectedTrackId),
    [selectedAlbum, selectedTrackId],
  );
  useEffect(
    () => () => {
      if (!selectedTrackId) return;
      acoustIdRequestId.current += 1;
      void window.outgroove.cancelAcoustIdTrackLookup({
        fileId: selectedTrackId,
      });
    },
    [selectedTrackId],
  );
  const technicalTrack = useMemo(
    () => selectedAlbum?.tracks.find((track) => track.id === technicalTrackId),
    [selectedAlbum, technicalTrackId],
  );
  const selectedBatchTracks = useMemo(
    () =>
      selectedAlbum?.tracks.filter((track) =>
        batchTrackIds.includes(track.id),
      ) ?? [],
    [batchTrackIds, selectedAlbum],
  );
  const orderedSequenceTracks = useMemo(
    () =>
      batchTrackIds.flatMap((fileId) => {
        const track = selectedAlbum?.tracks.find(
          (candidate) => candidate.id === fileId,
        );
        return track ? [track] : [];
      }),
    [batchTrackIds, selectedAlbum],
  );
  const editingSyncProfile = useMemo(
    () =>
      syncProfiles.find((candidate) => candidate.id === editingSyncProfileId),
    [editingSyncProfileId, syncProfiles],
  );
  const diagnosticsByAlbum = useMemo(
    () =>
      new Map(albums.map((album) => [album.id, diagnoseAlbum(album)] as const)),
    [albums],
  );
  const albumDiagnostics = useMemo(
    () =>
      selectedAlbum ? (diagnosticsByAlbum.get(selectedAlbum.id) ?? []) : [],
    [diagnosticsByAlbum, selectedAlbum],
  );
  const selectedAlbumReleaseDate = useMemo(
    () =>
      selectedAlbum
        ? summarizeAlbumReleaseDate(selectedAlbum.tracks)
        : undefined,
    [selectedAlbum],
  );
  const prepareAlbumCollectionReturn = useCallback((albumId: string): void => {
    albumReturnFocusId.current = albumId;
    albumCollectionScrollRestorePending.current = true;
    albumPointerForwardId.current = albumId;
  }, []);
  useEffect(() => {
    if (!diagnosticDestination) return;
    const target = {
      track: trackEditorRef.current,
      batch: batchEditorRef.current,
      sequence: sequenceEditorRef.current,
      "album-title": albumTitleEditorRef.current,
    }[diagnosticDestination.target];
    target?.focus();
  }, [diagnosticDestination]);

  useEffect(() => {
    setBatchTrackIds([]);
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setBatchError(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    setSequenceError(undefined);
    setLibraryTrackEditorOpen(false);
    setLibraryAlbumEditingTool(undefined);
    setTechnicalTrackId(undefined);
  }, [selectedAlbumId]);

  useEffect(() => {
    albumPointerForwardId.current = undefined;
    albumCollectionScrollRestorePending.current = false;
    albumReturnFocusId.current = undefined;
    setLibraryAlbumDetailOpen(false);
  }, [
    albumArtistFilter,
    albumIdFilter,
    libraryView,
    pageOffset,
    qualityFilter,
    query,
  ]);

  useLayoutEffect(() => {
    if (
      activeView !== "library" ||
      libraryAlbumDetailOpen ||
      !albumReturnFocusId.current ||
      !albumCollectionScrollRestorePending.current
    )
      return;
    const albumId = albumReturnFocusId.current;
    const position = albumCollectionScrollPosition.current;
    albumReturnFocusId.current = undefined;
    albumCollectionScrollRestorePending.current = false;
    albumTriggerRefs.current.get(albumId)?.focus({ preventScroll: true });
    window.scrollTo(position.left, position.top);
  }, [activeView, libraryAlbumDetailOpen]);

  useEffect(() => {
    if (
      libraryTrackEditorOpen ||
      activeView !== "library" ||
      !libraryAlbumDetailOpen ||
      !trackEditorReturnFocusId.current
    )
      return;
    const trackId = trackEditorReturnFocusId.current;
    trackEditorReturnFocusId.current = undefined;
    const returnElement = trackEditorReturnFocusElement.current;
    trackEditorReturnFocusElement.current = undefined;
    if (returnElement?.isConnected) returnElement.focus();
    else trackEditTriggerRefs.current.get(trackId)?.focus();
  }, [activeView, libraryAlbumDetailOpen, libraryTrackEditorOpen]);

  useEffect(() => {
    if (!albumDetailFocusPending.current) return;
    if (
      activeView !== "library" ||
      !libraryAlbumDetailOpen ||
      libraryTrackEditorOpen ||
      technicalTrack
    ) {
      albumDetailFocusPending.current = false;
      return;
    }
    albumDetailHeadingRef.current?.focus();
    albumDetailFocusPending.current = false;
  }, [
    activeView,
    libraryAlbumDetailOpen,
    libraryTrackEditorOpen,
    technicalTrack,
  ]);

  useEffect(() => {
    if (
      activeView !== "library" ||
      !libraryAlbumDetailOpen ||
      libraryTrackEditorOpen ||
      technicalTrack
    )
      return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (selectedAlbumId) prepareAlbumCollectionReturn(selectedAlbumId);
      setLibraryAlbumDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [
    activeView,
    libraryAlbumDetailOpen,
    libraryTrackEditorOpen,
    prepareAlbumCollectionReturn,
    selectedAlbumId,
    technicalTrack,
  ]);

  useEffect(() => {
    const navigateWithPointerButtons = (event: MouseEvent): void => {
      // DOM buttons 3 and 4 are the conventional browser Back/Forward side
      // buttons. Keep this history local to the Library hierarchy.
      const detailIsUnobstructed =
        activeView === "library" &&
        !libraryTrackEditorOpen &&
        !technicalTrack &&
        !libraryAlbumEditingTool &&
        !albumIdentificationOpen;
      if (
        event.button === 3 &&
        detailIsUnobstructed &&
        libraryAlbumDetailOpen &&
        selectedAlbum
      ) {
        event.preventDefault();
        prepareAlbumCollectionReturn(selectedAlbum.id);
        setLibraryAlbumDetailOpen(false);
        return;
      }
      if (
        event.button === 4 &&
        detailIsUnobstructed &&
        !libraryAlbumDetailOpen &&
        selectedAlbum &&
        albumPointerForwardId.current === selectedAlbum.id
      ) {
        event.preventDefault();
        albumCollectionScrollPosition.current = {
          left: window.scrollX,
          top: window.scrollY,
        };
        albumPointerForwardId.current = undefined;
        albumDetailFocusPending.current = true;
        setLibraryAlbumDetailOpen(true);
      }
    };
    window.addEventListener("mouseup", navigateWithPointerButtons);
    return () =>
      window.removeEventListener("mouseup", navigateWithPointerButtons);
  }, [
    activeView,
    albumIdentificationOpen,
    libraryAlbumDetailOpen,
    libraryAlbumEditingTool,
    libraryTrackEditorOpen,
    prepareAlbumCollectionReturn,
    selectedAlbum,
    technicalTrack,
  ]);

  const refreshCatalog = useCallback(async (): Promise<void> => {
    const requestId = ++libraryRequestId.current;
    const result = await window.outgroove.queryLibrary({
      query,
      view: libraryView,
      offset: pageOffset,
      limit: PAGE_SIZE,
      ...(libraryView === "data-quality" ? { qualityFilter } : {}),
      ...(libraryView === "albums" && albumArtistFilter
        ? { albumArtist: albumArtistFilter }
        : {}),
      ...(libraryView === "albums" && albumIdFilter
        ? { albumId: albumIdFilter }
        : {}),
      ...(libraryView === "tracks" && trackFormatFilter
        ? { format: trackFormatFilter }
        : {}),
      ...(libraryView === "tracks" && trackFolderFilter
        ? { folderId: trackFolderFilter.id }
        : {}),
      ...(libraryView === "tracks" && trackGenreFilter
        ? trackGenreFilter.missing
          ? { missingGenre: true as const }
          : { genre: trackGenreFilter.name }
        : {}),
    });
    if (requestId !== libraryRequestId.current) return;
    setCatalogLoaded(true);
    if (result.ok) {
      if (result.value.totalItems <= pageOffset && pageOffset > 0) {
        setPageOffset(
          result.value.totalItems === 0
            ? 0
            : Math.floor((result.value.totalItems - 1) / PAGE_SIZE) * PAGE_SIZE,
        );
        return;
      }
      setAlbums(result.value.albums);
      setArtists(result.value.artists);
      setGenres(result.value.genres ?? []);
      setFormats(result.value.formats);
      setFolders(result.value.folders);
      setTracks(result.value.tracks);
      setScanErrors(result.value.scanErrors);
      setTotalItems(result.value.totalItems);
      setSelectedAlbumId((current) =>
        current && result.value.albums.some((album) => album.id === current)
          ? current
          : result.value.albums[0]?.id,
      );
    } else setNotice(result.error.message, "error");
  }, [
    albumArtistFilter,
    albumIdFilter,
    libraryView,
    pageOffset,
    qualityFilter,
    query,
    trackFolderFilter,
    trackFormatFilter,
    trackGenreFilter,
  ]);

  useEffect(() => {
    if (albums.length === 0) return;
    const albumIds = albums.map((album) => album.id);
    let cancelled = false;
    setArtworkByAlbum((current) => {
      const next = new Map<string, AlbumArtworkThumbnailDto | "loading">();
      for (const albumId of albumIds)
        next.set(albumId, current.get(albumId) ?? "loading");
      return next;
    });
    void window.outgroove.loadAlbumArtwork({ albumIds }).then((result) => {
      if (cancelled) return;
      setArtworkByAlbum((current) => {
        const next = new Map<string, AlbumArtworkThumbnailDto | "loading">();
        for (const albumId of albumIds)
          next.set(albumId, current.get(albumId) ?? "loading");
        if (result.ok)
          for (const artwork of result.value)
            next.set(artwork.albumId, artwork);
        else
          for (const albumId of albumIds)
            next.set(albumId, { albumId, status: "invalid" });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [albums]);

  const refreshEditHistory = useCallback(
    async (albumId: string): Promise<void> => {
      const result = await window.outgroove.listAlbumEditHistory({ albumId });
      if (result.ok) setEditHistory(result.value);
      else setNotice(result.error.message, "error");
    },
    [],
  );

  const refreshLibraryRoots = useCallback(async (): Promise<void> => {
    const result = await window.outgroove.listLibraryRoots();
    if (result.ok) {
      setLibraryRoots(result.value);
      setRootId((current) =>
        current && result.value.some((root) => root.id === current)
          ? current
          : result.value[0]?.id,
      );
    } else setNotice(result.error.message, "error");
    setLibraryRootsLoaded(true);
  }, []);

  const refreshSavedFilters = useCallback(async (): Promise<boolean> => {
    const result = await window.outgroove.listSavedLibraryFilters();
    if (result.ok) {
      setSavedFilters(result.value);
      setSavedFilterNames(
        Object.fromEntries(result.value.map((saved) => [saved.id, saved.name])),
      );
      return true;
    }
    setNotice(result.error.message, "error");
    return false;
  }, []);

  const refreshFavoriteArtists = useCallback(
    async (query: string): Promise<boolean> => {
      const result = await window.outgroove.listFavoriteArtists({ query });
      if (result.ok) {
        setFavoriteArtists(result.value);
        const allResult = query
          ? await window.outgroove.listFavoriteArtists({ query: "" })
          : result;
        if (!allResult.ok) {
          setNotice(allResult.error.message, "error");
          return false;
        }
        setAllFavoriteArtists(allResult.value);
        setFavoriteArtistIds(
          allResult.value.map((favorite) => favorite.musicBrainzArtistId),
        );
        return true;
      }
      setNotice(result.error.message, "error");
      return false;
    },
    [],
  );

  const refreshRadarItems = useCallback(
    async (
      view: RadarReleaseView,
      primaryType: RadarPrimaryTypeFilter,
      favoriteArtistId: string | null,
      unseenOnly: boolean,
      includeDismissed: boolean,
      offset: number,
    ): Promise<boolean> => {
      setRadarLoading(true);
      const result = await window.outgroove.listRadarItems({
        view,
        primaryType,
        favoriteArtistId,
        unseenOnly,
        includeDismissed,
        offset,
        limit: radarPageLimit,
      });
      setRadarLoading(false);
      if (result.ok) {
        setRadarItems(result.value.items);
        setRadarTotalItems(result.value.totalItems);
        setRadarOffset(result.value.offset);
        setRadarSummary(result.value.summary);
        return true;
      }
      setRadarError(result.error.message);
      return false;
    },
    [],
  );

  const refreshSyncProfiles = useCallback(async (): Promise<
    readonly SyncProfileDto[] | undefined
  > => {
    const result = await window.outgroove.listSyncProfiles();
    if (result.ok) {
      setSyncProfiles(result.value);
      return result.value;
    }
    setNotice(result.error.message, "error");
    return undefined;
  }, []);

  const refreshSyncHistory = useCallback(
    async (profileId: string): Promise<boolean> => {
      const requestId = ++syncHistoryRequestId.current;
      setSyncHistoryProfileId(profileId);
      setSyncHistory([]);
      setSyncHistoryLoading(true);
      const result = await window.outgroove.listSyncHistory({ profileId });
      if (requestId !== syncHistoryRequestId.current) return false;
      setSyncHistoryLoading(false);
      if (result.ok) {
        setSyncHistory(result.value);
        return true;
      }
      setNotice(result.error.message, "error");
      return false;
    },
    [],
  );

  const refreshSyncRecoveries = useCallback(async (): Promise<void> => {
    const result = await window.outgroove.listSyncRecoveries();
    if (result.ok) {
      setSyncRecoveries(result.value);
      setSyncRecoveryPreview(undefined);
    } else setNotice(result.error.message, "error");
  }, []);

  useEffect(() => window.outgroove.onJobProgress(setProgress), []);
  useEffect(() => {
    const unsubscribe = window.outgroove.onScanJobUpdated((job) => {
      setScanJob(job);
      if (job.state === "completed" && job.result) {
        setNotice(
          `Scan finished: ${job.result.parsed} added or refreshed, ${job.result.unchanged} already up to date, ${job.result.errors} couldn’t be read.`,
          job.result.errors === 0 ? "success" : "error",
        );
        void refreshLibraryRoots();
        void refreshCatalog();
      } else if (job.state === "cancelled") setNotice(job.detail);
      else if (job.state === "failed" || job.state === "interrupted")
        setNotice(job.error ?? job.detail, "error");
    });
    void Promise.all([
      window.outgroove.listLibraryRoots(),
      window.outgroove.getLatestScanJob(),
    ]).then(([roots, latest]) => {
      if (roots.ok) {
        setLibraryRoots(roots.value);
        const latestRootId =
          latest.ok &&
          latest.value &&
          roots.value.some((root) => root.id === latest.value?.rootId)
            ? latest.value.rootId
            : undefined;
        setRootId(latestRootId ?? roots.value[0]?.id);
      } else setNotice(roots.error.message, "error");
      setLibraryRootsLoaded(true);
      if (latest.ok && latest.value) {
        setScanJob(latest.value);
        if (
          latest.value.state === "failed" ||
          latest.value.state === "interrupted"
        )
          setNotice(latest.value.error ?? latest.value.detail, "error");
      }
    });
    return unsubscribe;
  }, [refreshCatalog, refreshLibraryRoots]);
  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);
  useEffect(() => {
    void refreshSavedFilters();
  }, [refreshSavedFilters]);
  useEffect(() => {
    void refreshFavoriteArtists("");
  }, [refreshFavoriteArtists]);
  useEffect(() => {
    void refreshRadarItems("all", "all", null, false, false, 0);
  }, [refreshRadarItems]);
  useEffect(() => {
    const unsubscribe = window.outgroove.onRadarBackgroundRefreshUpdated(
      (settings) => {
        setRadarBackgroundSettings(settings);
        if (settings.lastCheckedAt) {
          void refreshFavoriteArtists(favoriteFilter);
          void refreshRadarItems(
            radarView,
            radarPrimaryType,
            radarFavoriteArtistId,
            radarUnseenOnly,
            radarIncludeDismissed,
            radarOffset,
          );
        }
      },
    );
    void window.outgroove.getRadarBackgroundRefreshSettings().then((result) => {
      if (result.ok) setRadarBackgroundSettings(result.value);
      else setRadarBackgroundError(result.error.message);
    });
    return unsubscribe;
  }, [
    favoriteFilter,
    radarIncludeDismissed,
    radarFavoriteArtistId,
    radarOffset,
    radarPrimaryType,
    radarUnseenOnly,
    radarView,
    refreshFavoriteArtists,
    refreshRadarItems,
  ]);
  useEffect(
    () =>
      window.outgroove.onOpenRadarRequested(() => {
        setActiveView("radar");
        setRadarUnseenOnly(true);
        setRadarOffset(0);
      }),
    [],
  );
  useEffect(() => {
    void refreshSyncProfiles();
  }, [refreshSyncProfiles]);
  useEffect(() => {
    void refreshSyncRecoveries();
  }, [refreshSyncRecoveries]);

  useEffect(() => {
    if (syncPlan) syncPlanHeadingRef.current?.focus();
  }, [syncPlan]);
  useEffect(() => {
    if (syncTargetPreview) syncTargetPreviewHeadingRef.current?.focus();
  }, [syncTargetPreview]);
  useEffect(() => {
    if (syncProfileRemovalPreview)
      syncProfileRemovalPreviewHeadingRef.current?.focus();
  }, [syncProfileRemovalPreview]);
  useEffect(() => {
    if (syncRecoveryPreview) syncRecoveryPreviewHeadingRef.current?.focus();
  }, [syncRecoveryPreview]);
  useEffect(() => {
    if (syncRecoveryFeedback) syncRecoveryFeedbackHeadingRef.current?.focus();
  }, [syncRecoveryFeedback]);
  useEffect(() => {
    if (!selectedAlbumId) {
      setEditHistory([]);
      return;
    }
    let current = true;
    setEditPreview(undefined);
    setEditResult(undefined);
    setEditError(undefined);
    setUndoPreview(undefined);
    setUndoResult(undefined);
    setArtworkEditPreview(undefined);
    setArtworkEditResult(undefined);
    setArtworkEditResultAction(undefined);
    setArtworkEditError(undefined);
    setArtworkExportPreview(undefined);
    setArtworkExportResult(undefined);
    setArtworkExportError(undefined);
    setFolderArtworkPreview(undefined);
    setFolderArtworkResult(undefined);
    setFolderArtworkError(undefined);
    setArtworkUndoPreview(undefined);
    setArtworkUndoResult(undefined);
    setHistoryError(undefined);
    setSelectedTrackId(undefined);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setTrackUndoPreview(undefined);
    setTrackUndoResult(undefined);
    setAcoustIdPreview(undefined);
    setAcoustIdResult(undefined);
    setAcoustIdError(undefined);
    setAcoustIdBusy(false);
    setBatchUndoPreview(undefined);
    setBatchUndoResult(undefined);
    setBatchError(undefined);
    setSequenceError(undefined);
    void window.outgroove
      .listAlbumEditHistory({ albumId: selectedAlbumId })
      .then((result) => {
        if (!current) return;
        if (result.ok) setEditHistory(result.value);
        else setNotice(result.error.message, "error");
      });
    return () => {
      current = false;
    };
  }, [selectedAlbumId]);

  useEffect(() => {
    if (!pendingTrackId || !selectedAlbum) return;
    const track = selectedAlbum.tracks.find(
      (candidate) => candidate.id === pendingTrackId,
    );
    if (!track) return;
    setSelectedTrackId(track.id);
    trackEditorReturnFocusId.current = track.id;
    setActiveView("library");
    setLibraryAlbumDetailOpen(true);
    setLibraryTrackEditorOpen(true);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setTrackUndoPreview(undefined);
    setAcoustIdPreview(undefined);
    setAcoustIdResult(undefined);
    setAcoustIdError(undefined);
    setAcoustIdBusy(false);
    setTrackDraft(draftForTrack(track));
    setPendingTrackId(undefined);
  }, [pendingTrackId, selectedAlbum]);

  const startScan = async (selectedRootId: string): Promise<boolean> => {
    setLibrarySetupError(undefined);
    setRootId(selectedRootId);
    const started = await window.outgroove.scanLibrary({
      rootId: selectedRootId,
    });
    if (started.ok) {
      setScanJob(started.value);
      setNotice(
        "Scan started. You can cancel it without losing the previous catalog.",
      );
      return true;
    }
    setLibrarySetupError(started.error.message);
    setNotice(started.error.message, "error");
    return false;
  };

  const selectLibraryFolder = async (): Promise<LibraryRootDto | undefined> => {
    setLibrarySetupError(undefined);
    const selected = await window.outgroove.chooseLibraryFolder();
    if (!selected.ok) {
      setLibrarySetupError(selected.error.message);
      setNotice(selected.error.message, "error");
      return undefined;
    }
    if (!selected.value) {
      setNotice("Folder selection cancelled.");
      return undefined;
    }
    const selectedRoot = selected.value;
    setLibraryRoots((current) => {
      const existing = current.find((root) => root.id === selectedRoot.id);
      return existing
        ? current.map((root) =>
            root.id === selectedRoot.id ? selectedRoot : root,
          )
        : [...current, selectedRoot];
    });
    setLibraryRootsLoaded(true);
    setRootId(selectedRoot.id);
    setNotice(
      "Library folder added. Start its read-only scan when you're ready.",
      "success",
    );
    return selectedRoot;
  };

  const chooseFirstLibraryFolder = async (): Promise<void> => {
    setBusy(true);
    try {
      await selectLibraryFolder();
    } finally {
      setBusy(false);
    }
  };

  const chooseAndScan = async (): Promise<void> => {
    setBusy(true);
    try {
      const selectedRoot = await selectLibraryFolder();
      if (selectedRoot) await startScan(selectedRoot.id);
    } finally {
      setBusy(false);
    }
  };

  const rescan = async (): Promise<void> => {
    if (!rootId) return;
    await startScan(rootId);
  };

  const startFirstScan = async (selectedRootId: string): Promise<void> => {
    setBusy(true);
    try {
      if (await startScan(selectedRootId)) setActiveView("activity");
    } finally {
      setBusy(false);
    }
  };

  const previewRootRemoval = async (rootId: string): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.previewLibraryRootRemoval({
        rootId,
      });
      if (result.ok) setRootRemovalPreview(result.value);
      else setNotice(result.error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const applyRootRemoval = async (): Promise<void> => {
    if (!rootRemovalPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyLibraryRootRemoval({
        operationId: rootRemovalPreview.operationId,
        confirmationToken: rootRemovalPreview.confirmationToken,
      });
      if (!result.ok) {
        setNotice(result.error.message, "error");
        return;
      }
      setRootRemovalPreview(undefined);
      if (scanJob?.rootId === result.value.rootId) setScanJob(undefined);
      await Promise.all([refreshLibraryRoots(), refreshCatalog()]);
      setNotice(
        `Stopped watching ${rootRemovalPreview.path}. ${result.value.visibleTracksHidden} visible tracks hidden; no audio files deleted.`,
        "success",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelScan = async (): Promise<void> => {
    if (!scanJob || !scanActive) return;
    const cancelled = await window.outgroove.cancelScan({ jobId: scanJob.id });
    if (cancelled.ok) setScanJob(cancelled.value);
    else setNotice(cancelled.error.message, "error");
  };

  const filterFavoriteArtists = (): void => {
    const next = favoriteFilterText.trim();
    setFavoriteFilter(next);
    void refreshFavoriteArtists(next);
  };

  const clearFavoriteArtistFilter = (): void => {
    setFavoriteFilterText("");
    setFavoriteFilter("");
    void refreshFavoriteArtists("");
  };

  const searchMusicBrainzArtists = async (): Promise<void> => {
    const query = artistSearchText.trim();
    if (!query) return;
    const requestId = ++artistSearchRequestId.current;
    setArtistSearchLoading(true);
    setArtistSearchResult(undefined);
    setArtistSearchError(undefined);
    const result = await window.outgroove.searchMusicBrainzArtists({ query });
    if (requestId !== artistSearchRequestId.current) return;
    setArtistSearchLoading(false);
    if (result.ok) {
      setArtistSearchResult(result.value);
      return;
    }
    setArtistSearchError(result.error.message);
  };

  const cancelMusicBrainzArtistSearch = (): void => {
    artistSearchRequestId.current += 1;
    setArtistSearchLoading(false);
    setArtistSearchError(undefined);
    void window.outgroove.cancelMusicBrainzArtistSearch().then((result) => {
      if (!result.ok) {
        setArtistSearchError(result.error.message);
        return;
      }
      if (result.value.cancelled)
        setNotice("Cancelled the MusicBrainz artist search.");
    });
  };

  const refreshFavoriteRadar = async (
    favorite: FavoriteArtistDto,
  ): Promise<void> => {
    setRefreshingFavoriteId(favorite.id);
    setRadarError(undefined);
    setRadarRefreshResult(undefined);
    const result = await window.outgroove.refreshRadar({
      favoriteArtistId: favorite.id,
    });
    setRefreshingFavoriteId(undefined);
    if (!result.ok) {
      setRadarError(result.error.message);
      return;
    }
    setRadarRefreshResult(result.value);
    await refreshFavoriteArtists(favoriteFilter);
    await refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      radarOffset,
    );
    setNotice(
      `Refreshed Radar for ${result.value.favoriteArtistName}.`,
      "success",
    );
  };

  const refreshAllFavoriteRadar = async (): Promise<void> => {
    setRadarRefreshAllActive(true);
    setRadarRefreshAllCancelling(false);
    setRadarRefreshAllResult(undefined);
    setRadarRefreshResult(undefined);
    setRadarError(undefined);
    const result = await window.outgroove.refreshAllRadar();
    setRadarRefreshAllActive(false);
    setRadarRefreshAllCancelling(false);
    if (!result.ok) {
      setRadarError(result.error.message);
      return;
    }
    setRadarRefreshAllResult(result.value);
    await refreshFavoriteArtists(favoriteFilter);
    await refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      radarOffset,
    );
    if (result.value.cancelled) {
      setNotice(
        `Stopped Radar after ${result.value.completed} of ${result.value.totalFavorites} favorites.`,
      );
    } else if (result.value.failed > 0) {
      setNotice(
        `Radar refreshed ${result.value.successful} favorites; ${result.value.failed} need attention.`,
        "error",
      );
    } else {
      setNotice(
        `Refreshed Radar for ${result.value.successful} favorites.`,
        "success",
      );
    }
  };

  const cancelAllFavoriteRadarRefresh = (): void => {
    setRadarRefreshAllCancelling(true);
    void window.outgroove.cancelAllRadarRefresh().then((result) => {
      if (!result.ok) {
        setRadarRefreshAllCancelling(false);
        setRadarError(result.error.message);
        return;
      }
      if (!result.value.cancelled) {
        setRadarRefreshAllCancelling(false);
        setRadarError("No Refresh all operation is currently running.");
      }
    });
  };

  const updateRadarBackgroundRefresh = async (
    enabled: boolean,
    pauseOnBattery: boolean,
    notificationsEnabled: boolean,
  ): Promise<void> => {
    setRadarBackgroundBusy(true);
    setRadarBackgroundError(undefined);
    const result = await window.outgroove.updateRadarBackgroundRefreshSettings({
      enabled,
      pauseOnBattery,
      notificationsEnabled,
    });
    setRadarBackgroundBusy(false);
    if (result.ok) setRadarBackgroundSettings(result.value);
    else setRadarBackgroundError(result.error.message);
  };

  const cancelFavoriteRadarRefresh = (favorite: FavoriteArtistDto): void => {
    void window.outgroove
      .cancelRadarRefresh({ favoriteArtistId: favorite.id })
      .then((result) => {
        if (!result.ok) {
          setRadarError(result.error.message);
          return;
        }
        if (result.value.cancelled) {
          setRefreshingFavoriteId(undefined);
          setRadarError(
            "Radar refresh cancelled. The last successful view is unchanged.",
          );
        }
      });
  };

  const chooseRadarView = (view: RadarReleaseView): void => {
    setRadarView(view);
    setRadarOffset(0);
    setRadarError(undefined);
    void refreshRadarItems(
      view,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      0,
    );
  };

  const chooseRadarPrimaryType = (
    primaryType: RadarPrimaryTypeFilter,
  ): void => {
    setRadarPrimaryType(primaryType);
    setRadarOffset(0);
    setRadarError(undefined);
    void refreshRadarItems(
      radarView,
      primaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      0,
    );
  };

  const chooseRadarFavoriteArtist = (favoriteArtistId: string | null): void => {
    setRadarFavoriteArtistId(favoriteArtistId);
    setRadarOffset(0);
    setRadarError(undefined);
    void refreshRadarItems(
      radarView,
      radarPrimaryType,
      favoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      0,
    );
  };

  const chooseRadarUnseenOnly = (unseenOnly: boolean): void => {
    setRadarUnseenOnly(unseenOnly);
    setRadarOffset(0);
    setRadarError(undefined);
    void refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      unseenOnly,
      radarIncludeDismissed,
      0,
    );
  };

  const chooseRadarDismissed = (includeDismissed: boolean): void => {
    setRadarIncludeDismissed(includeDismissed);
    setRadarOffset(0);
    setRadarError(undefined);
    void refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      includeDismissed,
      0,
    );
  };

  const chooseRadarPage = (offset: number): void => {
    setRadarError(undefined);
    void refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      offset,
    );
  };

  const setRadarSeen = async (
    item: RadarItemDto,
    seen: boolean,
  ): Promise<void> => {
    setRadarActionBusyId(item.id);
    const result = await window.outgroove.setRadarItemSeen({
      id: item.id,
      seen,
    });
    setRadarActionBusyId(undefined);
    if (!result.ok) {
      setRadarError(result.error.message);
      return;
    }
    await refreshFavoriteArtists(favoriteFilter);
    await refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      seen && radarUnseenOnly && radarItems.length === 1 && radarOffset > 0
        ? Math.max(0, radarOffset - radarPageLimit)
        : radarOffset,
    );
  };

  const setRadarDismissed = async (
    item: RadarItemDto,
    dismissed: boolean,
  ): Promise<void> => {
    setRadarActionBusyId(item.id);
    const result = await window.outgroove.setRadarItemDismissed({
      id: item.id,
      dismissed,
    });
    setRadarActionBusyId(undefined);
    if (!result.ok) {
      setRadarError(result.error.message);
      return;
    }
    await refreshFavoriteArtists(favoriteFilter);
    const nextOffset =
      dismissed &&
      !radarIncludeDismissed &&
      radarItems.length === 1 &&
      radarOffset > 0
        ? Math.max(0, radarOffset - radarPageLimit)
        : radarOffset;
    await refreshRadarItems(
      radarView,
      radarPrimaryType,
      radarFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      nextOffset,
    );
  };

  const openRadarItem = async (item: RadarItemDto): Promise<void> => {
    setRadarActionBusyId(item.id);
    setRadarError(undefined);
    const result = await window.outgroove.openRadarItemInMusicBrainz({
      id: item.id,
    });
    setRadarActionBusyId(undefined);
    if (!result.ok) setRadarError(result.error.message);
  };

  const addFavoriteArtist = async (artistId: string): Promise<void> => {
    setFavoriteMutationBusy(true);
    const result = await window.outgroove.addFavoriteArtist({ artistId });
    setFavoriteMutationBusy(false);
    if (!result.ok) {
      setArtistSearchError(result.error.message);
      return;
    }
    setFavoriteArtistIds((artistIds) => [
      ...new Set([...artistIds, result.value.musicBrainzArtistId]),
    ]);
    setAllFavoriteArtists((favorites) =>
      [...favorites, result.value].sort((left, right) =>
        left.sortName.localeCompare(right.sortName),
      ),
    );
    await refreshFavoriteArtists(favoriteFilter);
    setNotice(`Added ${result.value.name} to favorite artists.`, "success");
  };

  const removeFavoriteArtist = async (): Promise<void> => {
    if (!favoriteRemoval) return;
    setFavoriteMutationBusy(true);
    const result = await window.outgroove.removeFavoriteArtist({
      id: favoriteRemoval.id,
    });
    setFavoriteMutationBusy(false);
    if (!result.ok) {
      setNotice(result.error.message, "error");
      return;
    }
    const removedName = favoriteRemoval.name;
    const removedArtistId = favoriteRemoval.musicBrainzArtistId;
    setFavoriteRemoval(undefined);
    setFavoriteArtistIds((artistIds) =>
      artistIds.filter((artistId) => artistId !== removedArtistId),
    );
    setAllFavoriteArtists((favorites) =>
      favorites.filter((favorite) => favorite.id !== result.value.id),
    );
    const nextFavoriteArtistId =
      radarFavoriteArtistId === result.value.id ? null : radarFavoriteArtistId;
    setRadarFavoriteArtistId(nextFavoriteArtistId);
    await refreshFavoriteArtists(favoriteFilter);
    setRadarOffset(0);
    await refreshRadarItems(
      radarView,
      radarPrimaryType,
      nextFavoriteArtistId,
      radarUnseenOnly,
      radarIncludeDismissed,
      0,
    );
    setNotice(`Removed ${removedName} from favorite artists.`, "success");
  };

  const createBackup = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.createDatabaseBackup();
      if (!result.ok) setNotice(result.error.message, "error");
      else if (!result.value) setNotice("Backup not created.");
      else
        setNotice(`Backup saved and checked: ${result.value.path}`, "success");
    } finally {
      setBusy(false);
    }
  };

  const exportDiagnosticReport = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.exportDiagnosticReport();
      if (!result.ok) setNotice(result.error.message, "error");
      else if (!result.value) setNotice("Support report not created.");
      else
        setNotice(
          `Privacy-safe support report saved and checked: ${result.value.path}`,
          "success",
        );
    } finally {
      setBusy(false);
    }
  };

  const chooseRestore = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.chooseDatabaseRestore();
      if (!result.ok) setNotice(result.error.message, "error");
      else if (!result.value) setNotice("No backup selected.");
      else {
        setRestorePreview(result.value);
        setNotice("Backup checked. Review what it contains before restoring.");
      }
    } finally {
      setBusy(false);
    }
  };

  const applyRestore = async (): Promise<void> => {
    if (!restorePreview) return;
    setBusy(true);
    const result = await window.outgroove.applyDatabaseRestore({
      operationId: restorePreview.operationId,
      confirmationToken: restorePreview.confirmationToken,
    });
    if (result.ok)
      setNotice(
        `Restore complete. Outgroove is restarting. A safety backup of your previous setup was saved to ${result.value.rollbackBackupPath}`,
        "success",
      );
    else {
      setBusy(false);
      setNotice(result.error.message, "error");
    }
  };

  const previewEdit = async (): Promise<void> => {
    if (!selectedAlbum) return;
    setEditResult(undefined);
    setEditError(undefined);
    const result = await window.outgroove.previewAlbumTitleEdit({
      albumId: selectedAlbum.id,
      proposedTitle: editTitle,
    });
    if (result.ok) {
      setUndoPreview(undefined);
      setEditPreview(result.value);
    } else {
      setEditError(result.error.message);
      setNotice(result.error.message, "error");
    }
  };

  const applyEdit = async (): Promise<void> => {
    if (!editPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyAlbumTitleEdit({
        operationId: editPreview.operationId,
        confirmationToken: editPreview.confirmationToken,
      });
      if (result.ok) {
        setEditResult(result.value);
        setEditError(undefined);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Verified ${result.value.results.length} tag writes.`
            : `${failures.length} writes failed verification. Originals were retained or restored.`,
          failures.length === 0 ? "success" : "error",
        );
        setEditPreview(undefined);
        setEditTitle("");
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setEditError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const previewUndo = async (operationId: string): Promise<void> => {
    setHistoryError(undefined);
    const result = await window.outgroove.previewAlbumTitleUndo({
      operationId,
    });
    if (result.ok) {
      setEditPreview(undefined);
      setUndoResult(undefined);
      setTrackUndoPreview(undefined);
      setTrackUndoResult(undefined);
      setBatchUndoPreview(undefined);
      setBatchUndoResult(undefined);
      setUndoPreview(result.value);
    } else {
      setHistoryError(result.error.message);
      setNotice(result.error.message, "error");
    }
  };

  const applyUndo = async (): Promise<void> => {
    if (!undoPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyAlbumTitleUndo({
        operationId: undoPreview.operationId,
        confirmationToken: undoPreview.confirmationToken,
      });
      if (result.ok) {
        setUndoResult(result.value);
        setHistoryError(undefined);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Verified undo for ${result.value.results.length} files.`
            : `${failures.length} files were not undone. Conflicts or verification failures remain visible in history.`,
          failures.length === 0 ? "success" : "error",
        );
        setUndoPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const chooseArtwork = async (): Promise<void> => {
    if (!selectedAlbum) return;
    setBusy(true);
    setArtworkEditError(undefined);
    setArtworkEditResult(undefined);
    setArtworkEditResultAction(undefined);
    try {
      const result = await window.outgroove.chooseAlbumArtworkEdit({
        albumId: selectedAlbum.id,
      });
      if (!result.ok) {
        setArtworkEditError(result.error.message);
        setNotice(result.error.message, "error");
      } else if (result.value) {
        setArtworkEditPreview(result.value);
      }
    } finally {
      setBusy(false);
    }
  };

  const prepareArtworkRemoval = async (): Promise<void> => {
    if (!selectedAlbum) return;
    setBusy(true);
    setArtworkEditError(undefined);
    setArtworkEditResult(undefined);
    setArtworkEditResultAction(undefined);
    try {
      const result = await window.outgroove.previewAlbumArtworkRemoval({
        albumId: selectedAlbum.id,
      });
      if (result.ok) {
        setArtworkEditPreview(result.value);
      } else {
        setArtworkEditError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const applyArtwork = async (): Promise<void> => {
    if (!artworkEditPreview) return;
    const action = artworkEditPreview.action;
    const intendedWrites = artworkEditPreview.files.filter(
      (file) => file.willWrite,
    ).length;
    setBusy(true);
    try {
      const result = await window.outgroove.applyAlbumArtworkEdit({
        operationId: artworkEditPreview.operationId,
        confirmationToken: artworkEditPreview.confirmationToken,
      });
      if (result.ok) {
        setArtworkEditResult(result.value);
        setArtworkEditResultAction(action === "remove" ? "remove" : "replace");
        setArtworkEditPreview(undefined);
        setArtworkExportPreview(undefined);
        setArtworkExportResult(undefined);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? action === "remove"
              ? `Verified embedded front-cover removal for ${intendedWrites} files.`
              : `Verified embedded artwork for ${result.value.results.length} files.`
            : `${failures.length} files kept their previous artwork.`,
          failures.length === 0 ? "success" : "error",
        );
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setArtworkEditError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const prepareArtworkExport = async (): Promise<void> => {
    if (!selectedAlbum) return;
    setBusy(true);
    setArtworkExportError(undefined);
    setArtworkExportResult(undefined);
    try {
      const result = await window.outgroove.previewAlbumArtworkExport({
        albumId: selectedAlbum.id,
      });
      if (result.ok) {
        setArtworkExportPreview(result.value);
      } else {
        setArtworkExportError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const exportArtwork = async (): Promise<void> => {
    if (!artworkExportPreview) return;
    setBusy(true);
    setArtworkExportError(undefined);
    try {
      const result = await window.outgroove.exportAlbumArtwork({
        operationId: artworkExportPreview.operationId,
        confirmationToken: artworkExportPreview.confirmationToken,
      });
      if (!result.ok) {
        setArtworkExportError(result.error.message);
        setNotice(result.error.message, "error");
      } else if (result.value === null) {
        setNotice("Artwork export cancelled.");
      } else {
        setArtworkExportPreview(undefined);
        setArtworkExportResult(result.value);
        setNotice("Artwork exported and verified.", "success");
      }
    } finally {
      setBusy(false);
    }
  };

  const prepareFolderArtwork = async (): Promise<void> => {
    if (!selectedAlbum) return;
    setBusy(true);
    setFolderArtworkError(undefined);
    setFolderArtworkResult(undefined);
    try {
      const result = await window.outgroove.previewAlbumFolderArtwork({
        albumId: selectedAlbum.id,
      });
      if (result.ok) {
        setFolderArtworkPreview(result.value);
      } else {
        setFolderArtworkError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const applyFolderArtwork = async (): Promise<void> => {
    if (!folderArtworkPreview) return;
    setBusy(true);
    setFolderArtworkError(undefined);
    try {
      const result = await window.outgroove.applyAlbumFolderArtwork({
        operationId: folderArtworkPreview.operationId,
        confirmationToken: folderArtworkPreview.confirmationToken,
      });
      if (result.ok) {
        setFolderArtworkPreview(undefined);
        setFolderArtworkResult(result.value);
        setNotice("Folder artwork created and verified.", "success");
        await refreshCatalog();
      } else {
        setFolderArtworkError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const previewArtworkUndo = async (operationId: string): Promise<void> => {
    setHistoryError(undefined);
    const result = await window.outgroove.previewAlbumArtworkUndo({
      operationId,
    });
    if (result.ok) {
      setArtworkUndoResult(undefined);
      setUndoPreview(undefined);
      setTrackUndoPreview(undefined);
      setBatchUndoPreview(undefined);
      setArtworkUndoPreview(result.value);
    } else {
      setHistoryError(result.error.message);
      setNotice(result.error.message, "error");
    }
  };

  const applyArtworkUndo = async (): Promise<void> => {
    if (!artworkUndoPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyAlbumArtworkUndo({
        operationId: artworkUndoPreview.operationId,
        confirmationToken: artworkUndoPreview.confirmationToken,
      });
      if (result.ok) {
        setArtworkUndoResult(result.value);
        setArtworkUndoPreview(undefined);
        setArtworkExportPreview(undefined);
        setArtworkExportResult(undefined);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Verified artwork restore for ${result.value.results.length} files.`
            : `${failures.length} files were not restored because they changed or failed verification.`,
          failures.length === 0 ? "success" : "error",
        );
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const editLibraryTrack = (track: CatalogAlbum["tracks"][number]): void => {
    setMetadataDraftSource(undefined);
    trackEditorReturnFocusId.current = track.id;
    trackEditorReturnFocusElement.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    if (selectedTrackId !== track.id) {
      if (selectedTrackId)
        void window.outgroove.cancelAcoustIdTrackLookup({
          fileId: selectedTrackId,
        });
      acoustIdRequestId.current += 1;
      setAcoustIdPreview(undefined);
      setAcoustIdResult(undefined);
      setAcoustIdError(undefined);
      setAcoustIdBusy(false);
      setSelectedTrackId(track.id);
      setTrackEditPreview(undefined);
      setTrackEditResult(undefined);
      setTrackEditError(undefined);
      setTrackUndoPreview(undefined);
      setTrackDraft(draftForTrack(track));
    }
    setLibraryTrackEditorOpen(true);
  };

  const clearAcoustIdIdentification = (): void => {
    const fileId = selectedTrackId;
    acoustIdRequestId.current += 1;
    setAcoustIdPreview(undefined);
    setAcoustIdResult(undefined);
    setAcoustIdError(undefined);
    setAcoustIdBusy(false);
    if (fileId) void window.outgroove.cancelAcoustIdTrackLookup({ fileId });
  };

  const closeTrackEditor = (): void => {
    clearAcoustIdIdentification();
    setLibraryTrackEditorOpen(false);
  };

  const previewAcoustIdIdentification = async (): Promise<void> => {
    if (!selectedTrack) return;
    const requestId = ++acoustIdRequestId.current;
    setAcoustIdPreview(undefined);
    setAcoustIdResult(undefined);
    setAcoustIdError(undefined);
    setAcoustIdBusy(true);
    const result = await window.outgroove.previewAcoustIdTrackLookup({
      fileId: selectedTrack.id,
    });
    if (requestId !== acoustIdRequestId.current) return;
    setAcoustIdBusy(false);
    if (result.ok) setAcoustIdPreview(result.value);
    else setAcoustIdError(result.error.message);
  };

  const confirmAcoustIdIdentification = async (): Promise<void> => {
    if (!acoustIdPreview) return;
    const requestId = ++acoustIdRequestId.current;
    setAcoustIdError(undefined);
    setAcoustIdBusy(true);
    const result = await window.outgroove.confirmAcoustIdTrackLookup({
      operationId: acoustIdPreview.operationId,
      confirmationToken: acoustIdPreview.confirmationToken,
    });
    if (requestId !== acoustIdRequestId.current) return;
    setAcoustIdBusy(false);
    if (result.ok) {
      setAcoustIdPreview(undefined);
      setAcoustIdResult(result.value);
    } else setAcoustIdError(result.error.message);
  };

  const useAcoustIdRecordingId = (recordingId: string): void => {
    if (
      !selectedTrack ||
      selectedTrack.tags.musicBrainzRecordingId === recordingId
    )
      return;
    setTrackDraft((draft) => ({
      ...draft,
      musicBrainzRecordingId: recordingId,
    }));
    setMetadataDraftSource(
      "Added the MusicBrainz recording ID from the AcoustID match you selected. Review it with the other changes before writing.",
    );
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
  };

  const routeDiagnostic = (finding: AlbumDiagnostic): void => {
    if (!selectedAlbum) return;
    setActiveView("library");
    setLibraryAlbumDetailOpen(true);
    const affectedIds = [...finding.affectedTrackIds];
    setBatchTrackIds(affectedIds);
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setBatchError(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    setSequenceError(undefined);
    let target: "track" | "batch" | "sequence" | "album-title";
    switch (finding.workflow) {
      case "track-editor": {
        const firstTrack = selectedAlbum.tracks.find((track) =>
          affectedIds.includes(track.id),
        );
        if (firstTrack) editLibraryTrack(firstTrack);
        target = "track";
        break;
      }
      case "sequence":
        target = "sequence";
        setLibraryAlbumEditingTool("sequence");
        break;
      case "batch-track-artist":
        setBatchEnabled({
          artist: true,
          albumArtist: false,
          trackTotal: false,
          discNumber: false,
          discTotal: false,
          year: false,
          genre: false,
          composer: false,
          conductor: false,
          lyricist: false,
          isrc: false,
          copyright: false,
          originalReleaseDate: false,
          language: false,
          publisher: false,
          grouping: false,
          catalogNumber: false,
          publishingDate: false,
          compilation: false,
          musicBrainzReleaseId: false,
          musicBrainzReleaseArtistId: false,
          musicBrainzReleaseGroupId: false,
        });
        setBatchDraft((draft) => ({ ...draft, artist: "" }));
        target = "batch";
        setLibraryAlbumEditingTool("shared");
        break;
      case "batch-album-artist":
        setBatchEnabled({
          artist: false,
          albumArtist: true,
          trackTotal: false,
          discNumber: false,
          discTotal: false,
          year: false,
          genre: false,
          composer: false,
          conductor: false,
          lyricist: false,
          isrc: false,
          copyright: false,
          originalReleaseDate: false,
          language: false,
          publisher: false,
          grouping: false,
          catalogNumber: false,
          publishingDate: false,
          compilation: false,
          musicBrainzReleaseId: false,
          musicBrainzReleaseArtistId: false,
          musicBrainzReleaseGroupId: false,
        });
        setBatchDraft((draft) => ({ ...draft, albumArtist: "" }));
        target = "batch";
        setLibraryAlbumEditingTool("shared");
        break;
      case "batch-release-date":
        setBatchEnabled({
          artist: false,
          albumArtist: false,
          trackTotal: false,
          discNumber: false,
          discTotal: false,
          year: true,
          genre: false,
          composer: false,
          conductor: false,
          lyricist: false,
          isrc: false,
          copyright: false,
          originalReleaseDate: false,
          language: false,
          publisher: false,
          grouping: false,
          catalogNumber: false,
          publishingDate: false,
          compilation: false,
          musicBrainzReleaseId: false,
          musicBrainzReleaseArtistId: false,
          musicBrainzReleaseGroupId: false,
        });
        setBatchDraft((draft) => ({ ...draft, year: "" }));
        target = "batch";
        setLibraryAlbumEditingTool("shared");
        break;
      case "album-title":
        target = "album-title";
        setAlbumTitleSection("edit");
        setLibraryAlbumEditingTool("title");
        break;
    }
    setNotice(
      "Affected tracks selected. Review and propose a change for this album; no preview or write has started.",
    );
    setDiagnosticDestination((current) => ({
      target,
      request: (current?.request ?? 0) + 1,
    }));
  };

  const previewTrackEdit = async (): Promise<void> => {
    if (!selectedTrack) return;
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    const result = await window.outgroove.previewTrackTagEdit({
      fileId: selectedTrack.id,
      changes: {
        title: trackDraft.title,
        artist: trackDraft.artist,
        albumArtist: trackDraft.albumArtist,
        trackNumber: trackDraft.trackNumber
          ? Number(trackDraft.trackNumber)
          : null,
        trackTotal: trackDraft.trackTotal
          ? Number(trackDraft.trackTotal)
          : null,
        discNumber: trackDraft.discNumber
          ? Number(trackDraft.discNumber)
          : null,
        discTotal: trackDraft.discTotal ? Number(trackDraft.discTotal) : null,
        year: trackDraft.year || null,
        ...(trackDraft.genre !== (selectedTrack.tags.genres ?? []).join(" · ")
          ? { genres: trackDraft.genre ? [trackDraft.genre] : [] }
          : {}),
        ...(trackDraft.composer !==
        (selectedTrack.tags.composers ?? []).join(" · ")
          ? { composers: trackDraft.composer ? [trackDraft.composer] : [] }
          : {}),
        ...(trackDraft.conductor !==
        (selectedTrack.tags.conductors ?? []).join(" · ")
          ? {
              conductors: trackDraft.conductor ? [trackDraft.conductor] : [],
            }
          : {}),
        ...(trackDraft.lyricist !==
        (selectedTrack.tags.lyricists ?? []).join(" · ")
          ? { lyricists: trackDraft.lyricist ? [trackDraft.lyricist] : [] }
          : {}),
        ...(trackDraft.isrc !== (selectedTrack.tags.isrcs ?? []).join(" · ")
          ? { isrcs: trackDraft.isrc ? [trackDraft.isrc] : [] }
          : {}),
        ...(trackDraft.copyright !== (selectedTrack.tags.copyright ?? "")
          ? { copyright: trackDraft.copyright || null }
          : {}),
        ...(trackDraft.originalReleaseDate !==
        (selectedTrack.tags.originalReleaseDate ?? "")
          ? { originalReleaseDate: trackDraft.originalReleaseDate || null }
          : {}),
        ...(trackDraft.language !== (selectedTrack.tags.language ?? "")
          ? { language: trackDraft.language || null }
          : {}),
        ...(trackDraft.comment !== (selectedTrack.tags.comment ?? "")
          ? { comment: trackDraft.comment || null }
          : {}),
        ...(trackDraft.publisher !==
        (selectedTrack.tags.publishers ?? []).join(" · ")
          ? { publishers: trackDraft.publisher ? [trackDraft.publisher] : [] }
          : {}),
        ...(trackDraft.description !==
        (selectedTrack.tags.descriptions ?? []).join(" · ")
          ? {
              descriptions: trackDraft.description
                ? [trackDraft.description]
                : [],
            }
          : {}),
        ...(trackDraft.grouping !== (selectedTrack.tags.grouping ?? "")
          ? { grouping: trackDraft.grouping || null }
          : {}),
        ...(trackDraft.catalogNumber !==
        (selectedTrack.tags.catalogNumbers ?? []).join(" · ")
          ? {
              catalogNumbers: trackDraft.catalogNumber
                ? [trackDraft.catalogNumber]
                : [],
            }
          : {}),
        ...(trackDraft.publishingDate !==
        (selectedTrack.tags.publishingDate ?? "")
          ? { publishingDate: trackDraft.publishingDate || null }
          : {}),
        ...(trackDraft.bpm !== (selectedTrack.tags.bpm?.toString() ?? "")
          ? { bpm: trackDraft.bpm ? Number(trackDraft.bpm) : null }
          : {}),
        ...(trackDraft.compilation !==
        (selectedTrack.tags.compilation === true ? "true" : "false")
          ? { compilation: trackDraft.compilation === "true" }
          : {}),
        ...(trackDraft.musicBrainzRecordingId !==
        (selectedTrack.tags.musicBrainzRecordingId ?? "")
          ? {
              musicBrainzRecordingId: trackDraft.musicBrainzRecordingId || null,
            }
          : {}),
        ...(trackDraft.musicBrainzReleaseTrackId !==
        (selectedTrack.tags.musicBrainzReleaseTrackId ?? "")
          ? {
              musicBrainzReleaseTrackId:
                trackDraft.musicBrainzReleaseTrackId || null,
            }
          : {}),
        ...(trackDraft.musicBrainzReleaseId !==
        (selectedTrack.tags.musicBrainzReleaseId ?? "")
          ? { musicBrainzReleaseId: trackDraft.musicBrainzReleaseId || null }
          : {}),
        ...(trackDraft.musicBrainzArtistId !==
        (selectedTrack.tags.musicBrainzArtistIds ?? []).join(" · ")
          ? {
              musicBrainzArtistIds: trackDraft.musicBrainzArtistId
                ? [trackDraft.musicBrainzArtistId]
                : [],
            }
          : {}),
        ...(trackDraft.musicBrainzReleaseArtistId !==
        (selectedTrack.tags.musicBrainzReleaseArtistIds ?? []).join(" · ")
          ? {
              musicBrainzReleaseArtistIds: trackDraft.musicBrainzReleaseArtistId
                ? [trackDraft.musicBrainzReleaseArtistId]
                : [],
            }
          : {}),
        ...(trackDraft.musicBrainzReleaseGroupId !==
        (selectedTrack.tags.musicBrainzReleaseGroupId ?? "")
          ? {
              musicBrainzReleaseGroupId:
                trackDraft.musicBrainzReleaseGroupId || null,
            }
          : {}),
        ...(trackDraft.musicBrainzWorkId !==
        (selectedTrack.tags.musicBrainzWorkId ?? "")
          ? { musicBrainzWorkId: trackDraft.musicBrainzWorkId || null }
          : {}),
      },
    });
    if (result.ok) setTrackEditPreview(result.value);
    else setTrackEditError(result.error.message);
  };

  const applyTrackEdit = async (): Promise<void> => {
    if (!trackEditPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackTagEdit({
        operationId: trackEditPreview.operationId,
        confirmationToken: trackEditPreview.confirmationToken,
      });
      if (result.ok) {
        setTrackEditResult(result.value);
        setTrackEditError(undefined);
        const written = result.value.results[0];
        if (written?.verified) {
          setTrackEditPreview(undefined);
          await refreshCatalog();
          if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
        }
      } else {
        setTrackEditError(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const previewTrackUndo = async (operationId: string): Promise<void> => {
    setHistoryError(undefined);
    const result = await window.outgroove.previewTrackTagUndo({ operationId });
    if (result.ok) {
      setEditPreview(undefined);
      setUndoPreview(undefined);
      setUndoResult(undefined);
      setTrackEditPreview(undefined);
      setTrackEditResult(undefined);
      setTrackEditError(undefined);
      setTrackUndoResult(undefined);
      setBatchUndoPreview(undefined);
      setBatchUndoResult(undefined);
      setTrackUndoPreview(result.value);
    } else {
      setHistoryError(result.error.message);
      setNotice(result.error.message, "error");
    }
  };

  const applyTrackUndo = async (): Promise<void> => {
    if (!trackUndoPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackTagUndo({
        operationId: trackUndoPreview.operationId,
        confirmationToken: trackUndoPreview.confirmationToken,
      });
      if (result.ok) {
        setTrackUndoResult(result.value);
        setHistoryError(undefined);
        const written = result.value.results[0];
        setNotice(
          written?.verified
            ? "Track metadata undo was re-read and verified."
            : `Track metadata was not undone: ${written?.error ?? "verification failed"}`,
          written?.verified ? "success" : "error",
        );
        if (written?.verified) {
          setTrackUndoPreview(undefined);
          await refreshCatalog();
          if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
        }
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleBatchTrack = (fileId: string): void => {
    setBatchTrackIds((selected) =>
      selected.includes(fileId)
        ? selected.filter((id) => id !== fileId)
        : [...selected, fileId],
    );
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setBatchError(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    setSequenceError(undefined);
  };

  const selectAllBatchTracks = (): void => {
    if (!selectedAlbum) return;
    setBatchTrackIds(selectedAlbum.tracks.map((track) => track.id));
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setBatchError(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    setSequenceError(undefined);
  };

  const clearBatchTracks = (): void => {
    setBatchTrackIds([]);
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setBatchError(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    setSequenceError(undefined);
  };

  const moveBatchTrack = (fileId: string, offset: -1 | 1): void => {
    setBatchTrackIds((selected) => {
      const index = selected.indexOf(fileId);
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= selected.length)
        return selected;
      const reordered = [...selected];
      const [track] = reordered.splice(index, 1);
      if (!track) return selected;
      reordered.splice(destination, 0, track);
      return reordered;
    });
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    setSequenceError(undefined);
  };

  const previewBatchEdit = async (): Promise<void> => {
    setBatchPreview(undefined);
    setBatchError(undefined);
    const changes: {
      artist?: string;
      albumArtist?: string;
      trackTotal?: number | null;
      discNumber?: number | null;
      discTotal?: number | null;
      year?: string | null;
      genres?: string[];
      composers?: string[];
      conductors?: string[];
      lyricists?: string[];
      isrcs?: string[];
      copyright?: string | null;
      originalReleaseDate?: string | null;
      language?: string | null;
      publishers?: string[];
      grouping?: string | null;
      catalogNumbers?: string[];
      publishingDate?: string | null;
      compilation?: boolean;
      musicBrainzReleaseId?: string | null;
      musicBrainzReleaseArtistIds?: string[];
      musicBrainzReleaseGroupId?: string | null;
    } = {};
    if (batchEnabled.artist) changes.artist = batchDraft.artist;
    if (batchEnabled.albumArtist) changes.albumArtist = batchDraft.albumArtist;
    if (batchEnabled.trackTotal)
      changes.trackTotal = batchDraft.trackTotal
        ? Number(batchDraft.trackTotal)
        : null;
    if (batchEnabled.discNumber)
      changes.discNumber = batchDraft.discNumber
        ? Number(batchDraft.discNumber)
        : null;
    if (batchEnabled.discTotal)
      changes.discTotal = batchDraft.discTotal
        ? Number(batchDraft.discTotal)
        : null;
    if (batchEnabled.year) changes.year = batchDraft.year || null;
    if (batchEnabled.genre)
      changes.genres = batchDraft.genre ? [batchDraft.genre] : [];
    if (batchEnabled.composer)
      changes.composers = batchDraft.composer ? [batchDraft.composer] : [];
    if (batchEnabled.conductor)
      changes.conductors = batchDraft.conductor ? [batchDraft.conductor] : [];
    if (batchEnabled.lyricist)
      changes.lyricists = batchDraft.lyricist ? [batchDraft.lyricist] : [];
    if (batchEnabled.isrc)
      changes.isrcs = batchDraft.isrc ? [batchDraft.isrc] : [];
    if (batchEnabled.copyright)
      changes.copyright = batchDraft.copyright || null;
    if (batchEnabled.originalReleaseDate)
      changes.originalReleaseDate = batchDraft.originalReleaseDate || null;
    if (batchEnabled.language) changes.language = batchDraft.language || null;
    if (batchEnabled.publisher)
      changes.publishers = batchDraft.publisher ? [batchDraft.publisher] : [];
    if (batchEnabled.grouping) changes.grouping = batchDraft.grouping || null;
    if (batchEnabled.catalogNumber)
      changes.catalogNumbers = batchDraft.catalogNumber
        ? [batchDraft.catalogNumber]
        : [];
    if (batchEnabled.publishingDate)
      changes.publishingDate = batchDraft.publishingDate || null;
    if (batchEnabled.compilation)
      changes.compilation = batchDraft.compilation === "true";
    if (batchEnabled.musicBrainzReleaseId)
      changes.musicBrainzReleaseId = batchDraft.musicBrainzReleaseId || null;
    if (batchEnabled.musicBrainzReleaseArtistId)
      changes.musicBrainzReleaseArtistIds =
        batchDraft.musicBrainzReleaseArtistId
          ? [batchDraft.musicBrainzReleaseArtistId]
          : [];
    if (batchEnabled.musicBrainzReleaseGroupId)
      changes.musicBrainzReleaseGroupId =
        batchDraft.musicBrainzReleaseGroupId || null;
    const result = await window.outgroove.previewTrackBatchEdit({
      fileIds: batchTrackIds,
      changes,
    });
    if (result.ok) {
      setBatchPreview(result.value);
      setBatchResult(undefined);
    } else setBatchError(result.error.message);
  };

  const applyBatchEdit = async (): Promise<void> => {
    if (!batchPreview) return;
    setBatchError(undefined);
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackBatchEdit({
        operationId: batchPreview.operationId,
        confirmationToken: batchPreview.confirmationToken,
      });
      if (result.ok) {
        setBatchResult(result.value);
        setBatchError(undefined);
        setBatchPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setBatchError(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const previewTrackNumberSequence = async (): Promise<void> => {
    setSequencePreview(undefined);
    setSequenceError(undefined);
    const result = await window.outgroove.previewTrackNumberSequence({
      fileIds: batchTrackIds,
      startNumber: Number(sequenceStart),
      ...(sequenceDiscEnabled
        ? { discNumber: Number(sequenceDiscNumber) }
        : {}),
    });
    if (result.ok) {
      setSequencePreview(result.value);
      setSequenceResult(undefined);
    } else setSequenceError(result.error.message);
  };

  const applyTrackNumberSequence = async (): Promise<void> => {
    if (!sequencePreview) return;
    setSequenceError(undefined);
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackNumberSequence({
        operationId: sequencePreview.operationId,
        confirmationToken: sequencePreview.confirmationToken,
      });
      if (result.ok) {
        setSequenceResult(result.value);
        setSequenceError(undefined);
        setSequencePreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setSequenceError(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const previewBatchUndo = async (
    operationId: string,
    kind: BatchUndoKind = "shared-fields",
  ): Promise<void> => {
    setHistoryError(undefined);
    const result = await window.outgroove.previewTrackBatchUndo({
      operationId,
    });
    if (result.ok) {
      setUndoPreview(undefined);
      setUndoResult(undefined);
      setTrackUndoPreview(undefined);
      setTrackUndoResult(undefined);
      setBatchResult(undefined);
      setBatchUndoKind(kind);
      setBatchUndoPreview(result.value);
      setBatchUndoResult(undefined);
    } else {
      setHistoryError(result.error.message);
      setNotice(result.error.message, "error");
    }
  };

  const applyBatchUndo = async (): Promise<void> => {
    if (!batchUndoPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackBatchUndo({
        operationId: batchUndoPreview.operationId,
        confirmationToken: batchUndoPreview.confirmationToken,
      });
      if (result.ok) {
        setBatchUndoResult(result.value);
        setHistoryError(undefined);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Re-read and verified ${result.value.results.length} batch undo writes.`
            : `${result.value.results.length - failures.length} undo writes verified; ${failures.length} refused or failed without stopping the others.`,
          failures.length === 0 ? "success" : "error",
        );
        setBatchUndoPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const chooseTarget = async (): Promise<void> => {
    if (syncAlbums.length === 0) return;
    const result = await window.outgroove.chooseSyncTargetAndCreateProfile({
      name:
        syncAlbums.length === 1
          ? `${syncAlbums[0]?.title ?? "Album"} DAP`
          : `Outgroove ${syncAlbums.length}-album DAP`,
      albumIds: syncAlbums.map((album) => album.id),
    });
    if (result.ok && result.value) {
      setProfile(result.value);
      setSyncPlan(undefined);
      setSyncStage("review");
      void refreshSyncHistory(result.value.id);
      const refreshed = await refreshSyncProfiles();
      if (refreshed) {
        const saved = refreshed.find(
          (candidate) => candidate.id === result.value?.id,
        );
        if (saved) setProfile(saved);
        setNotice(`DAP target selected: ${result.value.targetPath}`, "success");
      }
    } else if (!result.ok) setNotice(result.error.message, "error");
  };

  const toggleSyncAlbum = (
    album: Pick<CatalogAlbum, "id" | "title" | "albumArtist">,
  ): void => {
    const selected = syncAlbums.some((candidate) => candidate.id === album.id);
    if (!selected && syncAlbums.length >= 100) {
      setNotice("A DAP profile can contain up to 100 albums.");
      return;
    }
    setSyncAlbums((current) =>
      selected
        ? current.filter((candidate) => candidate.id !== album.id)
        : [...current, album]
            .map(({ id, title, albumArtist }) => ({ id, title, albumArtist }))
            .sort(
              (left, right) =>
                left.albumArtist.localeCompare(right.albumArtist) ||
                left.title.localeCompare(right.title) ||
                left.id.localeCompare(right.id),
            ),
    );
    setNotice(
      selected
        ? `Removed ${album.title} from the DAP selection.`
        : editingSyncProfile
          ? `Added ${album.title} to the ${editingSyncProfile.name} selection draft.`
          : `Added ${album.title} to the DAP selection. Choose a target only after the selection is complete.`,
    );
  };

  const currentLibraryFilterDefinition = ():
    SavedLibraryFilterDefinition | undefined => {
    if (albumIdFilter) return undefined;
    return {
      query,
      view: libraryView,
      ...(libraryView === "data-quality" ? { qualityFilter } : {}),
      ...(libraryView === "albums" && albumArtistFilter
        ? { albumArtist: albumArtistFilter }
        : {}),
      ...(libraryView === "tracks" && trackFormatFilter
        ? { format: trackFormatFilter }
        : {}),
      ...(libraryView === "tracks" && trackFolderFilter
        ? { folder: trackFolderFilter }
        : {}),
      ...(libraryView === "tracks" && trackGenreFilter
        ? { genre: trackGenreFilter }
        : {}),
    };
  };

  const saveCurrentLibraryFilter = async (): Promise<void> => {
    const definition = currentLibraryFilterDefinition();
    if (!definition) {
      setNotice(
        "Exact album-detail routes cannot be saved as Library filters.",
      );
      return;
    }
    const name = savedFilterName.trim();
    if (!name) return;
    setSavedFilterBusy(true);
    try {
      const result = await window.outgroove.createSavedLibraryFilter({
        name,
        definition,
      });
      if (result.ok) {
        setSavedFilterName("");
        if (await refreshSavedFilters())
          setNotice(`Saved Library filter “${result.value.name}”.`, "success");
      } else setNotice(result.error.message, "error");
    } finally {
      setSavedFilterBusy(false);
    }
  };

  const updateSavedLibraryFilter = async (
    saved: SavedLibraryFilterDto,
    name: string,
    definition: SavedLibraryFilterDefinition,
    action: "Renamed" | "Updated",
  ): Promise<void> => {
    setSavedFilterBusy(true);
    try {
      const result = await window.outgroove.updateSavedLibraryFilter({
        id: saved.id,
        name,
        definition,
      });
      if (result.ok) {
        if (await refreshSavedFilters())
          setNotice(
            `${action} saved Library filter “${result.value.name}”.`,
            "success",
          );
      } else setNotice(result.error.message, "error");
    } finally {
      setSavedFilterBusy(false);
    }
  };

  const replaceSavedLibraryFilter = async (
    saved: SavedLibraryFilterDto,
  ): Promise<void> => {
    const definition = currentLibraryFilterDefinition();
    if (!definition) {
      setNotice(
        "Exact album-detail routes cannot replace a saved Library filter.",
      );
      return;
    }
    await updateSavedLibraryFilter(saved, saved.name, definition, "Updated");
  };

  const openSavedLibraryFilter = (saved: SavedLibraryFilterDto): void => {
    const definition = saved.definition;
    setLibraryView(definition.view);
    setSearchText(definition.query);
    setQuery(definition.query);
    setQualityFilter(definition.qualityFilter ?? "all");
    setAlbumArtistFilter(definition.albumArtist);
    setAlbumIdFilter(undefined);
    setTrackRouteLabel(undefined);
    setPendingTrackId(undefined);
    setTrackFormatFilter(definition.format);
    setTrackFolderFilter(definition.folder);
    setTrackGenreFilter(definition.genre);
    setPageOffset(0);
    setNotice(`Opened saved Library filter “${saved.name}”.`);
  };

  const deleteSavedLibraryFilter = async (
    saved: SavedLibraryFilterDto,
  ): Promise<void> => {
    setSavedFilterBusy(true);
    try {
      const result = await window.outgroove.deleteSavedLibraryFilter({
        id: saved.id,
      });
      if (result.ok) {
        if (await refreshSavedFilters())
          setNotice(`Deleted saved Library filter “${saved.name}”.`, "success");
      } else setNotice(result.error.message, "error");
    } finally {
      setSavedFilterBusy(false);
    }
  };

  const planSync = async (
    cleanupEnabled = syncCleanupEnabled,
  ): Promise<void> => {
    if (!profile) return;
    const result = await window.outgroove.planSync({
      profileId: profile.id,
      cleanupEnabled,
    });
    if (result.ok) {
      setSyncPlan(result.value);
      setSyncTargetVolumeConfirmed(false);
    } else setNotice(result.error.message, "error");
  };

  const openSyncProfile = (saved: SyncProfileDto): void => {
    setActiveView("sync");
    setSyncStage("review");
    setEditingSyncProfileId(undefined);
    setSyncAlbums([]);
    setProfile(saved);
    setSyncPlan(undefined);
    setSyncCleanupEnabled(false);
    setSyncTargetVolumeConfirmed(false);
    setSyncTargetPreview(undefined);
    void refreshSyncHistory(saved.id);
    setNotice(
      `Opened DAP profile “${saved.name}”. Preview its copy plan before applying anything.`,
    );
  };

  const editSyncProfileAlbums = (saved: SyncProfileDto): void => {
    setActiveView("sync");
    setSyncStage("setup");
    setSyncSetupSection("selection");
    setProfile(saved);
    setSyncPlan(undefined);
    setSyncCleanupEnabled(false);
    setSyncTargetVolumeConfirmed(false);
    setEditingSyncProfileId(saved.id);
    setSyncAlbums(saved.albums);
    void refreshSyncHistory(saved.id);
    setNotice(
      `Editing albums for DAP profile “${saved.name}”. Add or remove albums in Sync, then save the selection.`,
    );
  };

  const cancelSyncProfileAlbumEdit = (): void => {
    const name = editingSyncProfile?.name ?? "DAP profile";
    setEditingSyncProfileId(undefined);
    setSyncAlbums([]);
    setSyncSetupSection("profiles");
    setNotice(`Discarded unsaved album-selection changes for “${name}”.`);
  };

  const saveSyncProfileAlbums = async (): Promise<void> => {
    if (!editingSyncProfile || syncAlbums.length === 0) return;
    setBusy(true);
    try {
      const result = await window.outgroove.updateSyncProfileAlbums({
        id: editingSyncProfile.id,
        albumIds: syncAlbums.map((album) => album.id),
      });
      if (result.ok) {
        setProfile(result.value);
        setSyncPlan(undefined);
        setSyncCleanupEnabled(false);
        setSyncTargetVolumeConfirmed(false);
        setEditingSyncProfileId(undefined);
        setSyncAlbums([]);
        setSyncStage("review");
        const refreshed = await refreshSyncProfiles();
        if (refreshed) {
          const saved = refreshed.find(
            (candidate) => candidate.id === result.value.id,
          );
          if (saved) setProfile(saved);
          setNotice(
            `Saved ${result.value.albumIds.length} albums in “${result.value.name}”. Its previous sync preview is invalid; create a fresh preview before applying.`,
            "success",
          );
        }
      } else setNotice(result.error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const startSyncProfileRename = (saved: SyncProfileDto): void => {
    setSyncSetupSection("profiles");
    setRenamingSyncProfileId(saved.id);
    setSyncProfileNameDraft(saved.name);
    setNotice(`Renaming DAP profile “${saved.name}”.`);
  };

  const cancelSyncProfileRename = (): void => {
    setRenamingSyncProfileId(undefined);
    setSyncProfileNameDraft("");
    setNotice("Discarded the unsaved DAP profile name.");
  };

  const renameSyncProfile = async (saved: SyncProfileDto): Promise<void> => {
    const name = syncProfileNameDraft.trim();
    if (!name) return;
    setBusy(true);
    try {
      const result = await window.outgroove.renameSyncProfile({
        id: saved.id,
        name,
      });
      if (result.ok) {
        setSyncProfiles((current) =>
          current.map((candidate) =>
            candidate.id === result.value.id ? result.value : candidate,
          ),
        );
        if (profile?.id === result.value.id) setProfile(result.value);
        setRenamingSyncProfileId(undefined);
        setSyncProfileNameDraft("");
        if (await refreshSyncProfiles())
          setNotice(
            `Renamed DAP profile “${saved.name}” to “${result.value.name}”. Its target, albums, saved records of synced files, and current sync preview are unchanged.`,
            "success",
          );
      } else setNotice(result.error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const chooseSyncProfileTarget = async (
    saved: SyncProfileDto,
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.chooseSyncProfileTarget({
        profileId: saved.id,
      });
      if (result.ok && result.value) {
        setSyncSetupSection("profiles");
        setProfile(saved);
        setSyncPlan(undefined);
        setSyncProfileRemovalPreview(undefined);
        setSyncTargetPreview(result.value);
        setNotice(
          result.value.identityRefresh
            ? `Review the updated storage details for “${saved.name}”. No files have been changed.`
            : `Review the DAP target change for “${saved.name}”. No files have been changed.`,
        );
      } else if (!result.ok) setNotice(result.error.message, "error");
      else setNotice("DAP target selection cancelled.");
    } finally {
      setBusy(false);
    }
  };

  const applySyncProfileTarget = async (): Promise<void> => {
    if (!syncTargetPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applySyncProfileTarget({
        operationId: syncTargetPreview.operationId,
        confirmationToken: syncTargetPreview.confirmationToken,
      });
      if (result.ok) {
        setProfile(result.value);
        setSyncPlan(undefined);
        setSyncCleanupEnabled(false);
        setSyncTargetVolumeConfirmed(false);
        setSyncTargetPreview(undefined);
        setSyncStage("review");
        setSyncProfiles((current) =>
          current.map((candidate) =>
            candidate.id === result.value.id ? result.value : candidate,
          ),
        );
        await refreshSyncProfiles();
        setNotice(
          syncTargetPreview.identityRefresh
            ? `Updated the saved storage details for “${result.value.name}”. Completed syncs were kept; create a fresh preview before applying.`
            : `Changed “${result.value.name}” to ${result.value.targetPath}. Completed syncs were kept; create a fresh preview before applying.`,
          "success",
        );
      } else setNotice(result.error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const previewSyncProfileRemoval = async (
    saved: SyncProfileDto,
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.previewSyncProfileRemoval({
        profileId: saved.id,
      });
      if (result.ok) {
        setSyncSetupSection("profiles");
        setSyncTargetPreview(undefined);
        setSyncProfileRemovalPreview(result.value);
        setNotice(
          `Review removal of DAP profile “${saved.name}”. No source audio or target file has been changed.`,
        );
      } else setNotice(result.error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const applySyncProfileRemoval = async (): Promise<void> => {
    if (!syncProfileRemovalPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applySyncProfileRemoval({
        operationId: syncProfileRemovalPreview.operationId,
        confirmationToken: syncProfileRemovalPreview.confirmationToken,
      });
      if (result.ok) {
        const removedActiveProfile = profile?.id === result.value.profileId;
        setSyncProfileRemovalPreview(undefined);
        setSyncTargetPreview(undefined);
        setRenamingSyncProfileId(undefined);
        setSyncProfileNameDraft("");
        if (editingSyncProfileId === result.value.profileId) {
          setEditingSyncProfileId(undefined);
          setSyncAlbums([]);
        }
        if (removedActiveProfile) {
          setProfile(undefined);
          setSyncPlan(undefined);
          setSyncCleanupEnabled(false);
          setSyncTargetVolumeConfirmed(false);
          setSyncHistory([]);
          setSyncHistoryProfileId(undefined);
          setSyncStage("setup");
        }
        await refreshSyncProfiles();
        setNotice(
          `Removed DAP profile “${result.value.profileName}” and ${result.value.removedSuccessfulSyncs} saved ${result.value.removedSuccessfulSyncs === 1 ? "sync record" : "sync records"}. Target files were left unchanged and are now unknown to Outgroove.`,
          "success",
        );
      } else setNotice(result.error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const applySync = async (): Promise<void> => {
    if (!syncPlan) return;
    const applyingPlan = syncPlan;
    setSyncApplyingPlanId(applyingPlan.id);
    setSyncCancellationRequested(false);
    setBusy(true);
    try {
      const result = await window.outgroove.applySync({
        planId: applyingPlan.id,
        confirmationToken: applyingPlan.confirmationToken,
        targetVolumeConfirmed: syncTargetVolumeConfirmed,
      });
      if (result.ok) {
        if (result.value.outcome === "completed")
          setNotice(
            `Sync complete: ${result.value.copied} copied, ${result.value.replaced} replaced, ${result.value.removed} removed, and ${result.value.unchanged} skipped unchanged. Outgroove saved its new record of synced files after all other work finished.${result.value.errors.length > 0 ? ` Some temporary Outgroove files still need recovery: ${result.value.errors.join(" ")}` : ""}`,
            result.value.errors.length === 0 ? "success" : "error",
          );
        else if (result.value.outcome === "cancelled")
          setNotice(
            result.value.errors.length === 0
              ? `Sync cancelled safely after ${result.value.copied} ${result.value.copied === 1 ? "copy" : "copies"} finished. Outgroove restored ${result.value.rolledBack} completed ${result.value.rolledBack === 1 ? "change" : "changes"} and did not save a new record of synced files. You can review and try this plan again.`
              : `Sync cancelled after ${result.value.copied} ${result.value.copied === 1 ? "copy" : "copies"} finished, but restoring the player needs attention. Outgroove restored ${result.value.rolledBack} completed ${result.value.rolledBack === 1 ? "change" : "changes"} and did not save a new record of synced files. ${result.value.errors.join(" ")}`,
            result.value.errors.length === 0 ? "info" : "error",
          );
        else
          setNotice(
            `Sync stopped. Outgroove restored ${result.value.rolledBack} completed ${result.value.rolledBack === 1 ? "change" : "changes"} and did not save a new record of synced files. Review the reported problem, then try this preview again. ${result.value.errors.join(" ")}`,
            "error",
          );
        if (result.value.outcome === "completed") {
          setSyncCleanupEnabled(false);
          setSyncTargetVolumeConfirmed(false);
          await planSync(false);
          await refreshSyncHistory(applyingPlan.profileId);
        }
        await refreshSyncRecoveries();
      } else setNotice(result.error.message, "error");
    } finally {
      setProgress((current) => (current?.job === "sync" ? undefined : current));
      setSyncApplyingPlanId(undefined);
      setSyncCancellationRequested(false);
      setBusy(false);
    }
  };

  const cancelSync = async (): Promise<void> => {
    if (!syncApplyingPlanId || syncCancellationRequested) return;
    const result = await window.outgroove.cancelSync({
      planId: syncApplyingPlanId,
    });
    if (!result.ok) {
      setNotice(result.error.message, "error");
      return;
    }
    if (result.value.accepted) {
      setSyncCancellationRequested(true);
      setNotice(
        "Cancelling safely. Outgroove will finish or discard the file it is currently preparing, then restore changes already completed by this sync.",
      );
    } else if (result.value.state === "finalizing")
      setNotice(
        "The sync is saving the playlist and its final record of synced files. This last step cannot be cancelled safely.",
      );
    else setNotice("The sync is no longer running.");
  };

  const applySyncRecovery = async (
    recovery: SyncRecoveryPreviewDto,
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.applySyncRecovery({
        runId: recovery.runId,
        confirmationToken: recovery.confirmationToken,
        targetVolumeConfirmed: syncRecoveryTargetVolumeConfirmed,
      });
      if (!result.ok) {
        setNotice(result.error.message, "error");
        await refreshSyncRecoveries();
        setSyncRecoveryFeedback({
          runId: recovery.runId,
          profileName: recovery.profileName,
          status: "failed",
          recovered: 0,
          messages: [result.error.message],
        });
        return;
      }
      await refreshSyncRecoveries();
      setSyncRecoveryFeedback({
        runId: recovery.runId,
        profileName: recovery.profileName,
        status: result.value.complete ? "complete" : "incomplete",
        recovered: result.value.recovered,
        messages:
          result.value.errors.length > 0
            ? result.value.errors
            : result.value.complete
              ? ["You can generate a fresh sync plan for this profile."]
              : [
                  "Reconnect the target or resolve the reported files, then review recovery again.",
                ],
      });
      if (result.value.complete) {
        await refreshSyncHistory(recovery.profileId);
        setNotice(
          result.value.errors.length === 0
            ? `The interrupted sync is now in a safe state: ${result.value.recovered} ${result.value.recovered === 1 ? "change was" : "changes were"} restored or removed. You can preview this profile again.`
            : `The interrupted sync is safe, with notes: ${result.value.errors.join(" ")}`,
          result.value.errors.length === 0 ? "success" : "error",
        );
      } else
        setNotice(
          `Outgroove could not finish making this interrupted sync safe. Reconnect the player or resolve the reported files, then review it again. ${result.value.errors.join(" ")}`,
          "error",
        );
    } finally {
      setBusy(false);
    }
  };

  const reviewSyncRecovery = async (
    recovery: SyncRecoverySummaryDto,
  ): Promise<void> => {
    setSyncRecoveryFeedback(undefined);
    setSyncRecoveryPreview(undefined);
    setSyncRecoveryTargetVolumeConfirmed(false);
    setBusy(true);
    try {
      const result = await window.outgroove.previewSyncRecovery({
        runId: recovery.runId,
      });
      if (result.ok) setSyncRecoveryPreview(result.value);
      else {
        setNotice(result.error.message, "error");
        setSyncRecoveryFeedback({
          runId: recovery.runId,
          profileName: recovery.profileName,
          status: "failed",
          recovered: 0,
          messages: [result.error.message],
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const libraryOnboardingVisible =
    activeView === "library" &&
    (!libraryRootsLoaded ||
      !catalogLoaded ||
      (albums.length === 0 &&
        totalItems === 0 &&
        (libraryRoots.length === 0 ||
          (libraryView === "albums" &&
            !query &&
            !albumArtistFilter &&
            !albumIdFilter))));

  const openLibraryAlbum = (album: CatalogAlbum): void => {
    albumCollectionScrollPosition.current = {
      left: window.scrollX,
      top: window.scrollY,
    };
    albumPointerForwardId.current = undefined;
    albumDetailFocusPending.current = true;
    setSelectedAlbumId(album.id);
    setLibraryAlbumDetailOpen(true);
    setEditPreview(undefined);
    setSyncPlan(undefined);
  };

  const openLibraryAlbumEditingTool = (tool: LibraryAlbumEditingTool): void => {
    if (!selectedAlbum) return;
    setMetadataDraftSource(undefined);
    setAlbumTitleSection(tool === "history" ? "history" : "edit");
    setLibraryAlbumEditingTool(tool);
    if (tool === "history") void refreshEditHistory(selectedAlbum.id);
  };

  const addSelectedAlbumToSync = (): void => {
    if (!selectedAlbum) return;
    if (!syncAlbums.some((album) => album.id === selectedAlbum.id))
      toggleSyncAlbum(selectedAlbum);
    setSyncStage("setup");
    setSyncSetupSection("selection");
    setActiveView("sync");
  };

  const openAlbumIdentification = (): void => {
    setAlbumIdentificationResult(undefined);
    setAlbumIdentificationError(undefined);
    setAlbumIdentificationLoading(false);
    setReleaseTracksLoading(false);
    setReleaseTracksReleaseId(undefined);
    setReleaseTracksResult(undefined);
    setReleaseTracksError(undefined);
    setCoverArtLoading(false);
    setCoverArtReleaseId(undefined);
    setCoverArtResult(undefined);
    setCoverArtError(undefined);
    setCoverArtPreparing(false);
    setCoverArtPrepareError(undefined);
    setMusicBrainzMappingPreview(undefined);
    setMusicBrainzMappingResult(undefined);
    setMusicBrainzMappingError(undefined);
    setAlbumIdentificationOpen(true);
  };

  const searchAlbumIdentification = async (): Promise<void> => {
    if (!selectedAlbum) return;
    const requestId = ++albumIdentificationRequestId.current;
    setAlbumIdentificationLoading(true);
    setAlbumIdentificationError(undefined);
    setReleaseTracksResult(undefined);
    setReleaseTracksReleaseId(undefined);
    setCoverArtResult(undefined);
    setCoverArtReleaseId(undefined);
    setCoverArtError(undefined);
    setCoverArtPreparing(false);
    setCoverArtPrepareError(undefined);
    setMusicBrainzMappingPreview(undefined);
    setMusicBrainzMappingResult(undefined);
    setMusicBrainzMappingError(undefined);
    const result = await window.outgroove.findMusicBrainzAlbumCandidates({
      albumId: selectedAlbum.id,
    });
    if (requestId !== albumIdentificationRequestId.current) return;
    setAlbumIdentificationLoading(false);
    if (result.ok) setAlbumIdentificationResult(result.value);
    else setAlbumIdentificationError(result.error.message);
  };

  const cancelAlbumIdentification = (): void => {
    if (!selectedAlbum) return;
    albumIdentificationRequestId.current += 1;
    setAlbumIdentificationLoading(false);
    setAlbumIdentificationError("Search cancelled. Your Library is unchanged.");
    void window.outgroove.cancelMusicBrainzAlbumCandidates({
      albumId: selectedAlbum.id,
    });
  };

  const loadMusicBrainzReleaseTracks = async (
    candidate: ComparedAlbumCandidate,
  ): Promise<void> => {
    if (!selectedAlbum) return;
    const requestId = ++albumIdentificationRequestId.current;
    setReleaseTracksReleaseId(candidate.releaseId);
    setReleaseTracksLoading(true);
    setReleaseTracksResult(undefined);
    setReleaseTracksError(undefined);
    setMusicBrainzMappingPreview(undefined);
    setMusicBrainzMappingResult(undefined);
    setMusicBrainzMappingError(undefined);
    const result = await window.outgroove.loadMusicBrainzReleaseTracks({
      albumId: selectedAlbum.id,
      releaseId: candidate.releaseId,
    });
    if (requestId !== albumIdentificationRequestId.current) return;
    setReleaseTracksLoading(false);
    if (result.ok) setReleaseTracksResult(result.value);
    else setReleaseTracksError(result.error.message);
  };

  const cancelMusicBrainzReleaseTracks = (): void => {
    if (!selectedAlbum) return;
    albumIdentificationRequestId.current += 1;
    setReleaseTracksLoading(false);
    setReleaseTracksError(
      "Track loading cancelled. Your Library is unchanged.",
    );
    void window.outgroove.cancelMusicBrainzAlbumCandidates({
      albumId: selectedAlbum.id,
    });
  };

  const loadCoverArtArchiveArtwork = async (
    candidate: ComparedAlbumCandidate,
  ): Promise<void> => {
    if (!selectedAlbum) return;
    const requestId = ++coverArtRequestId.current;
    setCoverArtReleaseId(candidate.releaseId);
    setCoverArtLoading(true);
    setCoverArtResult(undefined);
    setCoverArtError(undefined);
    setCoverArtPrepareError(undefined);
    const result = await window.outgroove.loadCoverArtArchiveArtwork({
      albumId: selectedAlbum.id,
      releaseId: candidate.releaseId,
    });
    if (requestId !== coverArtRequestId.current) return;
    setCoverArtLoading(false);
    if (result.ok) setCoverArtResult(result.value);
    else setCoverArtError(result.error.message);
  };

  const prepareCoverArtArchiveReplacement = async (
    candidate: ComparedAlbumCandidate,
    artworkId: string,
  ): Promise<void> => {
    if (!selectedAlbum) return;
    const requestId = ++coverArtRequestId.current;
    setCoverArtReleaseId(candidate.releaseId);
    setCoverArtPreparing(true);
    setCoverArtPrepareError(undefined);
    const result = await window.outgroove.previewCoverArtArchiveArtworkEdit({
      albumId: selectedAlbum.id,
      releaseId: candidate.releaseId,
      artworkId,
    });
    if (requestId !== coverArtRequestId.current) return;
    setCoverArtPreparing(false);
    if (!result.ok) {
      setCoverArtPrepareError(result.error.message);
      return;
    }
    setArtworkEditPreview(result.value);
    setArtworkEditResult(undefined);
    setArtworkEditResultAction(undefined);
    setArtworkEditError(undefined);
    setArtworkExportPreview(undefined);
    setArtworkExportResult(undefined);
    setArtworkExportError(undefined);
    setFolderArtworkPreview(undefined);
    setFolderArtworkResult(undefined);
    setFolderArtworkError(undefined);
    setAlbumIdentificationOpen(false);
    setLibraryAlbumEditingTool("artwork");
  };

  const cancelCoverArtArchiveArtwork = (): void => {
    if (!selectedAlbum) return;
    const preparing = coverArtPreparing;
    coverArtRequestId.current += 1;
    setCoverArtLoading(false);
    setCoverArtPreparing(false);
    if (preparing)
      setCoverArtPrepareError(
        "Artwork preparation cancelled. Your Library is unchanged.",
      );
    else
      setCoverArtError("Cover request cancelled. Your Library is unchanged.");
    void window.outgroove.cancelCoverArtArchiveArtwork({
      albumId: selectedAlbum.id,
    });
  };

  const previewMusicBrainzTrackMapping = async (
    edits: readonly MusicBrainzTrackMappingEdit[],
  ): Promise<void> => {
    if (!selectedAlbum || !releaseTracksResult) return;
    setMusicBrainzMappingPreview(undefined);
    setMusicBrainzMappingResult(undefined);
    setMusicBrainzMappingError(undefined);
    const result = await window.outgroove.previewMusicBrainzTrackMapping({
      albumId: selectedAlbum.id,
      releaseId: releaseTracksResult.release.releaseId,
      edits: [...edits],
    });
    if (result.ok) setMusicBrainzMappingPreview(result.value);
    else setMusicBrainzMappingError(result.error.message);
  };

  const applyMusicBrainzTrackMapping = async (): Promise<void> => {
    if (!musicBrainzMappingPreview) return;
    setMusicBrainzMappingError(undefined);
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackBatchEdit({
        operationId: musicBrainzMappingPreview.operationId,
        confirmationToken: musicBrainzMappingPreview.confirmationToken,
      });
      if (result.ok) {
        setMusicBrainzMappingResult(result.value);
        setMusicBrainzMappingPreview(undefined);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Re-read and verified ${result.value.results.length} mapped MusicBrainz track writes.`
            : `${failures.length} mapped tracks failed or were stale; other files were handled independently.`,
          failures.length === 0 ? "success" : "error",
        );
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else setMusicBrainzMappingError(result.error.message);
    } finally {
      setBusy(false);
    }
  };

  const closeAlbumIdentification = (): void => {
    if (albumIdentificationLoading) cancelAlbumIdentification();
    if (releaseTracksLoading) cancelMusicBrainzReleaseTracks();
    if (coverArtLoading || coverArtPreparing) cancelCoverArtArchiveArtwork();
    setAlbumIdentificationOpen(false);
  };

  const createMusicBrainzTagDraft = (
    candidate: ComparedAlbumCandidate,
  ): void => {
    if (!selectedAlbum) return;
    const candidateDraft = createAlbumCandidateTagDraft(
      selectedAlbum,
      candidate,
    );
    if (candidateDraft.fields.length === 0) {
      setNotice(
        "All album details Outgroove can use already match or are unavailable. No draft was created.",
      );
      return;
    }
    const source = `Added ${candidateDraft.fields.length} ${
      candidateDraft.fields.length === 1 ? "field" : "fields"
    } from the selected MusicBrainz release. Review every value before continuing; no file has changed.`;
    setMetadataDraftSource(source);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setBatchError(undefined);
    setAlbumIdentificationOpen(false);

    if (selectedAlbum.tracks.length === 1) {
      const track = selectedAlbum.tracks[0];
      if (!track) return;
      const nextDraft: TrackMetadataDraft = draftForTrack(track);
      for (const field of candidateDraft.fields)
        nextDraft[field.field] = field.value;
      setSelectedTrackId(track.id);
      setTrackDraft(nextDraft);
      setLibraryTrackEditorOpen(true);
    } else {
      const enabled = Object.fromEntries(
        Object.keys(batchEnabled).map((field) => [field, false]),
      ) as SharedFieldEnabled;
      const nextDraft = { ...batchDraft };
      for (const field of candidateDraft.fields) {
        enabled[field.field] = true;
        nextDraft[field.field] = field.value;
      }
      setBatchTrackIds(selectedAlbum.tracks.map((track) => track.id));
      setBatchEnabled(enabled);
      setBatchDraft(nextDraft);
      setLibraryAlbumEditingTool("shared");
    }
    setNotice(source);
  };

  const closeLibraryAlbum = (): void => {
    if (albumIdentificationOpen) closeAlbumIdentification();
    if (selectedAlbumId) prepareAlbumCollectionReturn(selectedAlbumId);
    setLibraryAlbumDetailOpen(false);
  };

  const renderTrackContext = (
    tool: "shared" | "sequence",
    onEditTrack: (track: CatalogAlbum["tracks"][number]) => void,
  ): React.JSX.Element | undefined =>
    selectedAlbum ? (
      <WorkbenchTrackContext
        busy={busy}
        selectedTrackIds={batchTrackIds}
        selectionPurpose={
          tool === "sequence" ? "track ordering" : "shared-field editing"
        }
        tracks={selectedAlbum.tracks}
        onClearSelection={clearBatchTracks}
        onEditTrack={onEditTrack}
        onSelectAll={selectAllBatchTracks}
        onToggleTrack={toggleBatchTrack}
      />
    ) : undefined;

  const sharedFieldEditor = (
    <SharedFieldEditor
      busy={busy}
      draft={batchDraft}
      {...(metadataDraftSource ? { draftSource: metadataDraftSource } : {})}
      enabled={batchEnabled}
      error={batchError}
      preview={batchPreview}
      ref={batchEditorRef}
      result={batchResult}
      tracks={selectedBatchTracks}
      onCancelPreview={() => {
        setBatchPreview(undefined);
        setBatchError(undefined);
      }}
      onConfirm={() => void applyBatchEdit()}
      onDraftChange={(field, value) => {
        setBatchDraft((draft) => ({
          ...draft,
          [field]: value,
        }));
        setBatchPreview(undefined);
        setBatchResult(undefined);
        setBatchError(undefined);
      }}
      onEnabledChange={(field, enabled) => {
        setBatchEnabled((current) => ({
          ...current,
          [field]: enabled,
        }));
        setBatchPreview(undefined);
        setBatchResult(undefined);
        setBatchError(undefined);
      }}
      onPreview={() => void previewBatchEdit()}
    />
  );

  const trackOrderEditor = (
    <TrackOrderEditor
      busy={busy}
      discDraft={sequenceDiscNumber}
      discEnabled={sequenceDiscEnabled}
      error={sequenceError}
      preview={sequencePreview}
      ref={sequenceEditorRef}
      result={sequenceResult}
      startDraft={sequenceStart}
      tracks={orderedSequenceTracks}
      onCancelPreview={() => {
        setSequencePreview(undefined);
        setSequenceError(undefined);
      }}
      onConfirm={() => void applyTrackNumberSequence()}
      onDiscChange={(value) => {
        setSequenceDiscNumber(value);
        setSequencePreview(undefined);
        setSequenceResult(undefined);
        setSequenceError(undefined);
      }}
      onDiscEnabledChange={(enabled) => {
        setSequenceDiscEnabled(enabled);
        setSequencePreview(undefined);
        setSequenceResult(undefined);
        setSequenceError(undefined);
      }}
      onMove={moveBatchTrack}
      onPreview={() => void previewTrackNumberSequence()}
      onStartChange={(value) => {
        setSequenceStart(value);
        setSequencePreview(undefined);
        setSequenceResult(undefined);
        setSequenceError(undefined);
      }}
    />
  );

  const renderAlbumTitleWorkbench = (
    showNavigation: boolean,
  ): React.JSX.Element | undefined =>
    selectedAlbum ? (
      <AlbumTitleWorkbench
        albumTitle={selectedAlbum.title}
        artworkUndoPreview={artworkUndoPreview}
        artworkUndoResult={artworkUndoResult}
        batchUndoKind={batchUndoKind}
        batchUndoPreview={batchUndoPreview}
        batchUndoResult={batchUndoResult}
        busy={busy}
        draftTitle={editTitle}
        editError={editError}
        editHistory={editHistory}
        editPreview={editPreview}
        editResult={editResult}
        historyError={historyError}
        onCancelBatchUndo={() => {
          setBatchUndoPreview(undefined);
          setHistoryError(undefined);
        }}
        onCancelArtworkUndo={() => {
          setArtworkUndoPreview(undefined);
          setHistoryError(undefined);
        }}
        onCancelEditPreview={() => {
          setEditPreview(undefined);
          setEditError(undefined);
        }}
        onCancelTrackUndo={() => {
          setTrackUndoPreview(undefined);
          setHistoryError(undefined);
        }}
        onCancelUndo={() => {
          setUndoPreview(undefined);
          setHistoryError(undefined);
        }}
        onConfirmBatchUndo={() => void applyBatchUndo()}
        onConfirmArtworkUndo={() => void applyArtworkUndo()}
        onConfirmEdit={() => void applyEdit()}
        onConfirmTrackUndo={() => void applyTrackUndo()}
        onConfirmUndo={() => void applyUndo()}
        onDraftTitleChange={(title) => {
          setEditTitle(title);
          setEditPreview(undefined);
          setEditResult(undefined);
          setEditError(undefined);
        }}
        onPreviewBatchUndo={(operationId, kind) =>
          void previewBatchUndo(operationId, kind)
        }
        onPreviewArtworkUndo={(operationId) =>
          void previewArtworkUndo(operationId)
        }
        onPreviewEdit={() => void previewEdit()}
        onPreviewTrackUndo={(operationId) => void previewTrackUndo(operationId)}
        onPreviewUndo={(operationId) => void previewUndo(operationId)}
        onSectionChange={setAlbumTitleSection}
        ref={albumTitleEditorRef}
        section={albumTitleSection}
        showNavigation={showNavigation}
        trackUndoPreview={trackUndoPreview}
        trackUndoResult={trackUndoResult}
        undoPreview={undoPreview}
        undoResult={undoResult}
      />
    ) : undefined;

  return (
    <ApplicationShell
      activeView={activeView}
      {...(inspectionSessionId ? { inspectionSessionId } : {})}
      notice={notice}
      onDismissNotice={() => setNoticeState(undefined)}
      onNavigate={setActiveView}
    >
      {progress &&
        progress.completed < progress.total &&
        activeView !== "activity" && (
          <div className="progress" aria-label={`${progress.job} progress`}>
            <progress value={progress.completed} max={progress.total} />
            <span>
              {progress.completed}/{progress.total}: {progress.detail}
            </span>
          </div>
        )}
      {activeView === "activity" && (
        <ActivityView
          busy={busy}
          progress={progress}
          scanActive={scanActive}
          scanJob={scanJob}
          onCancel={() => void cancelScan()}
          onChooseFolder={() => void chooseAndScan()}
          onOpenLibrary={() => setActiveView("library")}
          onOpenSync={() => setActiveView("sync")}
          onReviewScanProblems={() => {
            setLibraryView("scan-errors");
            setAlbumArtistFilter(undefined);
            setAlbumIdFilter(undefined);
            setTrackRouteLabel(undefined);
            setPendingTrackId(undefined);
            setTrackFormatFilter(undefined);
            setTrackFolderFilter(undefined);
            setTrackGenreFilter(undefined);
            setPageOffset(0);
            setActiveView("library");
          }}
          onRetry={(selectedRootId) => void startScan(selectedRootId)}
        />
      )}
      {activeView === "radar" && (
        <RadarView
          artistSearchError={artistSearchError}
          artistSearchLoading={artistSearchLoading}
          artistSearchResult={artistSearchResult}
          artistSearchText={artistSearchText}
          favoriteArtistIds={favoriteArtistIds}
          favoriteFilter={favoriteFilter}
          favoriteFilterText={favoriteFilterText}
          favorites={favoriteArtists}
          mutationBusy={favoriteMutationBusy}
          radarActionBusyId={radarActionBusyId}
          radarBackgroundBusy={radarBackgroundBusy}
          radarBackgroundError={radarBackgroundError}
          radarBackgroundSettings={radarBackgroundSettings}
          radarError={radarError}
          radarFavoriteArtistId={radarFavoriteArtistId}
          radarFilterFavorites={allFavoriteArtists}
          radarIncludeDismissed={radarIncludeDismissed}
          radarItems={radarItems}
          radarLimit={radarPageLimit}
          radarLoading={radarLoading}
          radarOffset={radarOffset}
          radarPrimaryType={radarPrimaryType}
          radarRefreshAllActive={radarRefreshAllActive}
          radarRefreshAllCancelling={radarRefreshAllCancelling}
          radarRefreshAllResult={radarRefreshAllResult}
          radarRefreshResult={radarRefreshResult}
          radarSummary={radarSummary}
          radarTotalItems={radarTotalItems}
          radarUnseenOnly={radarUnseenOnly}
          radarView={radarView}
          refreshingFavoriteId={refreshingFavoriteId}
          removal={favoriteRemoval}
          onAdd={(artistId) => void addFavoriteArtist(artistId)}
          onArtistSearchTextChange={setArtistSearchText}
          onCancelArtistSearch={cancelMusicBrainzArtistSearch}
          onCancelRemoval={() => setFavoriteRemoval(undefined)}
          onClearFavoriteFilter={clearFavoriteArtistFilter}
          onConfirmRemoval={() => void removeFavoriteArtist()}
          onFavoriteFilterTextChange={setFavoriteFilterText}
          onFilterFavorites={filterFavoriteArtists}
          onRadarDismissed={(item, dismissed) =>
            void setRadarDismissed(item, dismissed)
          }
          onRadarFavoriteArtistChange={chooseRadarFavoriteArtist}
          onRadarIncludeDismissedChange={chooseRadarDismissed}
          onRadarOpen={(item) => void openRadarItem(item)}
          onRadarPage={chooseRadarPage}
          onRadarPrimaryTypeChange={chooseRadarPrimaryType}
          onRadarSeen={(item, seen) => void setRadarSeen(item, seen)}
          onRadarUnseenOnlyChange={chooseRadarUnseenOnly}
          onRadarViewChange={chooseRadarView}
          onRadarBackgroundChange={(
            enabled,
            pauseOnBattery,
            notificationsEnabled,
          ) =>
            void updateRadarBackgroundRefresh(
              enabled,
              pauseOnBattery,
              notificationsEnabled,
            )
          }
          onRefreshAll={() => void refreshAllFavoriteRadar()}
          onRefreshFavorite={(favorite) => void refreshFavoriteRadar(favorite)}
          onCancelRefreshAll={cancelAllFavoriteRadarRefresh}
          onCancelRefresh={cancelFavoriteRadarRefresh}
          onRemove={setFavoriteRemoval}
          onSearchArtists={() => void searchMusicBrainzArtists()}
        />
      )}
      {activeView === "library" && (
        <>
          {!libraryOnboardingVisible && !libraryAlbumDetailOpen && (
            <>
              <form
                className="library-toolbar"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPageOffset(0);
                  setQuery(searchText.trim());
                }}
              >
                <label className="visually-hidden" htmlFor="library-search">
                  Search Library
                </label>
                <input
                  id="library-search"
                  type="search"
                  value={searchText}
                  placeholder="Album, artist, genre, track, format, or path"
                  onChange={(event) => setSearchText(event.target.value)}
                />
                <label className="visually-hidden" htmlFor="library-view">
                  View
                </label>
                <select
                  id="library-view"
                  value={libraryView}
                  onChange={(event) => {
                    const view = event.target.value as
                      | "albums"
                      | "artists"
                      | "genres"
                      | "formats"
                      | "folders"
                      | "tracks"
                      | "data-quality"
                      | "scan-errors";
                    setLibraryView(view);
                    setAlbumArtistFilter(undefined);
                    setAlbumIdFilter(undefined);
                    setTrackRouteLabel(undefined);
                    setPendingTrackId(undefined);
                    setTrackFormatFilter(undefined);
                    setTrackFolderFilter(undefined);
                    setTrackGenreFilter(undefined);
                    setPageOffset(0);
                    if (view === "data-quality")
                      setNotice(
                        "Checking album quality. You can keep browsing while Outgroove works.",
                      );
                  }}
                >
                  <option value="albums">Albums</option>
                  <option value="artists">Album artists</option>
                  <option value="genres">Genres</option>
                  <option value="formats">Formats</option>
                  <option value="folders">Folders</option>
                  <option value="tracks">Tracks</option>
                  <option value="data-quality">Albums needing review</option>
                  <option value="scan-errors">Scan problems</option>
                </select>
                {libraryView === "data-quality" && (
                  <>
                    <label htmlFor="quality-filter">Issue type</label>
                    <select
                      id="quality-filter"
                      value={qualityFilter}
                      onChange={(event) => {
                        const filter = event.target.value;
                        if (!isAlbumDiagnosticFilter(filter)) return;
                        setQualityFilter(filter);
                        setPageOffset(0);
                        setNotice(
                          `Checking ${diagnosticFilterLabels[filter].toLowerCase()}. You can keep browsing while Outgroove works.`,
                        );
                      }}
                    >
                      {albumDiagnosticFilters.map((filter) => (
                        <option key={filter} value={filter}>
                          {diagnosticFilterLabels[filter]}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button type="submit">Search</button>
                {(query || searchText) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchText("");
                      setQuery("");
                      setPageOffset(0);
                    }}
                  >
                    Clear search
                  </button>
                )}
                {libraryView === "albums" && albumArtistFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setAlbumArtistFilter(undefined);
                      setPageOffset(0);
                    }}
                  >
                    Show all album artists
                  </button>
                )}
                {libraryView === "albums" && albumIdFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setAlbumIdFilter(undefined);
                      setTrackRouteLabel(undefined);
                      setPendingTrackId(undefined);
                      setPageOffset(0);
                    }}
                  >
                    Show all albums
                  </button>
                )}
                {libraryView === "tracks" && trackFormatFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setTrackFormatFilter(undefined);
                      setPageOffset(0);
                    }}
                  >
                    Show all formats
                  </button>
                )}
                {libraryView === "tracks" && trackFolderFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setTrackFolderFilter(undefined);
                      setPageOffset(0);
                    }}
                  >
                    Show all folders
                  </button>
                )}
                {libraryView === "tracks" && trackGenreFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setTrackGenreFilter(undefined);
                      setPageOffset(0);
                    }}
                  >
                    Show all genres
                  </button>
                )}
              </form>
              <details className="library-tools-disclosure">
                <summary>
                  <div>
                    <strong>Library tools</strong>
                    <span>Saved filters and scanning</span>
                  </div>
                  <span>
                    {savedFilters.length === 0
                      ? "No saved filters"
                      : `${savedFilters.length} saved ${
                          savedFilters.length === 1 ? "filter" : "filters"
                        }`}
                  </span>
                </summary>
                <div className="library-tools-content">
                  <section
                    className="library-scan-tools"
                    aria-labelledby="library-scan-tools-title"
                  >
                    <div>
                      <p className="eyebrow">Keep your Library current</p>
                      <h2 id="library-scan-tools-title">
                        Folders and scanning
                      </h2>
                      <p>
                        Add a folder when you’re ready. Scanning stays on this
                        device and never changes your music.
                      </p>
                    </div>
                    <div className="actions">
                      <button
                        disabled={busy || scanActive}
                        onClick={() => void chooseAndScan()}
                      >
                        Choose Library folder
                      </button>
                      <button
                        disabled={busy || scanActive || !rootId}
                        onClick={() => void rescan()}
                      >
                        Scan current folder
                      </button>
                    </div>
                  </section>
                  <section
                    className="saved-filters"
                    aria-labelledby="saved-filters-title"
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">Get back here quickly</p>
                        <h2 id="saved-filters-title">Saved Library filters</h2>
                      </div>
                      <form
                        className="inline"
                        aria-label="Save current Library filter"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveCurrentLibraryFilter();
                        }}
                      >
                        <label htmlFor="saved-filter-name">Filter name</label>
                        <input
                          id="saved-filter-name"
                          value={savedFilterName}
                          maxLength={100}
                          placeholder="For example, Ambient FLAC"
                          onChange={(event) =>
                            setSavedFilterName(event.target.value)
                          }
                        />
                        <button
                          type="submit"
                          disabled={
                            savedFilterBusy ||
                            !savedFilterName.trim() ||
                            Boolean(albumIdFilter)
                          }
                        >
                          Save current filter
                        </button>
                      </form>
                    </div>
                    <p>
                      Saves the current search and view. Your page position and
                      open album are not included.
                    </p>
                    {albumIdFilter && (
                      <p>
                        Status: Return to a normal Library view before saving.
                      </p>
                    )}
                    {savedFilters.length === 0 ? (
                      <p>No saved Library filters yet.</p>
                    ) : (
                      <ul>
                        {savedFilters.map((saved) => (
                          <li key={saved.id}>
                            <div>
                              <strong>{saved.name}</strong>
                              <span>
                                {describeSavedFilter(saved.definition)}
                              </span>
                            </div>
                            <form
                              className="inline"
                              aria-label={`Rename ${saved.name}`}
                              onSubmit={(event) => {
                                event.preventDefault();
                                const name = (
                                  savedFilterNames[saved.id] ?? ""
                                ).trim();
                                if (name)
                                  void updateSavedLibraryFilter(
                                    saved,
                                    name,
                                    saved.definition,
                                    "Renamed",
                                  );
                              }}
                            >
                              <label htmlFor={`saved-filter-name-${saved.id}`}>
                                Name
                              </label>
                              <input
                                id={`saved-filter-name-${saved.id}`}
                                aria-label={`Name for ${saved.name}`}
                                value={savedFilterNames[saved.id] ?? saved.name}
                                maxLength={100}
                                onChange={(event) =>
                                  setSavedFilterNames((names) => ({
                                    ...names,
                                    [saved.id]: event.target.value,
                                  }))
                                }
                              />
                              <button
                                type="submit"
                                disabled={
                                  savedFilterBusy ||
                                  !(savedFilterNames[saved.id] ?? "").trim() ||
                                  (savedFilterNames[saved.id] ?? "").trim() ===
                                    saved.name
                                }
                              >
                                Rename {saved.name}
                              </button>
                            </form>
                            <button
                              disabled={savedFilterBusy}
                              onClick={() => openSavedLibraryFilter(saved)}
                            >
                              Open {saved.name}
                            </button>
                            <button
                              disabled={
                                savedFilterBusy || Boolean(albumIdFilter)
                              }
                              onClick={() =>
                                void replaceSavedLibraryFilter(saved)
                              }
                            >
                              Update {saved.name} to current filter
                            </button>
                            <button
                              disabled={savedFilterBusy}
                              onClick={() =>
                                void deleteSavedLibraryFilter(saved)
                              }
                            >
                              Delete {saved.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </details>
            </>
          )}
          {!libraryOnboardingVisible && !libraryAlbumDetailOpen && (
            <p className="result-count" aria-live="polite">
              {totalItems}{" "}
              {libraryView === "scan-errors"
                ? totalItems === 1
                  ? "scan problem"
                  : "scan problems"
                : libraryView === "artists"
                  ? totalItems === 1
                    ? "album artist"
                    : "album artists"
                  : libraryView === "genres"
                    ? totalItems === 1
                      ? "genre"
                      : "genres"
                    : libraryView === "formats"
                      ? totalItems === 1
                        ? "format"
                        : "formats"
                      : libraryView === "folders"
                        ? totalItems === 1
                          ? "folder"
                          : "folders"
                        : libraryView === "tracks"
                          ? totalItems === 1
                            ? "track"
                            : "tracks"
                          : libraryView === "data-quality"
                            ? totalItems === 1
                              ? "album needing review"
                              : "albums needing review"
                            : totalItems === 1
                              ? "album"
                              : "albums"}
              {query ? ` matching “${query}”` : ""}
              {libraryView === "data-quality" && qualityFilter !== "all"
                ? ` with ${diagnosticFilterLabels[qualityFilter].toLowerCase()}`
                : ""}
              {libraryView === "albums" && albumArtistFilter
                ? ` by “${albumArtistFilter}”`
                : ""}
              {libraryView === "albums" && trackRouteLabel
                ? ` containing “${trackRouteLabel}”`
                : ""}
              {libraryView === "tracks" && trackFormatFilter
                ? ` in “${trackFormatFilter}” format`
                : ""}
              {libraryView === "tracks" && trackFolderFilter
                ? ` in folder “${trackFolderFilter.path}”`
                : ""}
              {libraryView === "tracks" && trackGenreFilter
                ? trackGenreFilter.missing
                  ? " with no genre tag"
                  : ` with genre “${trackGenreFilter.name}”`
                : ""}
            </p>
          )}
          {libraryOnboardingVisible ? (
            <LibraryOnboarding
              busy={busy}
              catalogLoaded={catalogLoaded}
              libraryRoots={libraryRoots}
              rootsLoaded={libraryRootsLoaded}
              scanActive={scanActive}
              scanJob={scanJob}
              selectedRootId={rootId}
              setupError={librarySetupError}
              onChooseFolder={() => void chooseFirstLibraryFolder()}
              onOpenActivity={() => setActiveView("activity")}
              onStartScan={(selectedRootId) =>
                void startFirstScan(selectedRootId)
              }
            />
          ) : libraryView === "scan-errors" ? (
            <main className="errors" aria-labelledby="scan-errors">
              <h2 id="scan-errors">Scan problems</h2>
              {scanErrors.length === 0 ? (
                <p>No scan problems match this view.</p>
              ) : (
                <ul>
                  {scanErrors.map((error) => (
                    <li key={`${error.kind}:${error.path}`}>
                      <span>
                        {error.kind === "directory"
                          ? "Folder could not be scanned"
                          : "Audio file could not be read"}
                      </span>
                      <strong>{error.path}</strong>
                      <span>{error.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </main>
          ) : libraryView === "artists" ? (
            <main className="artists" aria-labelledby="album-artists">
              <h2 id="album-artists">Album artists</h2>
              {artists.length === 0 ? (
                <p>
                  {query
                    ? "No album artists match this search."
                    : "The current catalog has no album artists."}
                </p>
              ) : (
                <ul>
                  {artists.map((artist) => (
                    <li key={artist.name}>
                      <article>
                        <h3>{artist.name}</h3>
                        <p>
                          Status: {artist.albumCount}{" "}
                          {artist.albumCount === 1 ? "album" : "albums"} ·{" "}
                          {artist.trackCount}{" "}
                          {artist.trackCount === 1 ? "track" : "tracks"}
                        </p>
                        <button
                          onClick={() => {
                            setAlbumArtistFilter(artist.name);
                            setLibraryView("albums");
                            setSearchText("");
                            setQuery("");
                            setPageOffset(0);
                            setNotice(`Showing albums by ${artist.name}.`);
                          }}
                        >
                          Browse albums by {artist.name}
                        </button>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </main>
          ) : libraryView === "genres" ? (
            <main className="genres" aria-labelledby="library-genres">
              <h2 id="library-genres">Genres</h2>
              {genres.length === 0 ? (
                <p>
                  {query
                    ? "No genres match this search."
                    : "The current catalog has no genre entries."}
                </p>
              ) : (
                <ul>
                  {genres.map((genre) => (
                    <li
                      key={`${genre.missing ? "missing" : "tag"}:${genre.name}`}
                    >
                      <article>
                        <h3>{genre.name}</h3>
                        <p>
                          Status: {genre.trackCount}{" "}
                          {genre.trackCount === 1 ? "track" : "tracks"}
                        </p>
                        <button
                          onClick={() => {
                            setTrackGenreFilter({
                              name: genre.name,
                              missing: genre.missing,
                            });
                            setTrackFormatFilter(undefined);
                            setTrackFolderFilter(undefined);
                            setLibraryView("tracks");
                            setSearchText("");
                            setQuery("");
                            setPageOffset(0);
                            setNotice(
                              genre.missing
                                ? "Showing tracks with no genre tag from the local catalog."
                                : `Showing tracks tagged ${genre.name} from the local catalog.`,
                            );
                          }}
                        >
                          {genre.missing
                            ? "Browse tracks with no genre tag"
                            : `Browse ${genre.name} tracks`}
                        </button>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </main>
          ) : libraryView === "formats" ? (
            <main className="formats" aria-labelledby="library-formats">
              <h2 id="library-formats">Formats</h2>
              {formats.length === 0 ? (
                <p>
                  {query
                    ? "No formats match this search."
                    : "The current catalog has no formats."}
                </p>
              ) : (
                <ul>
                  {formats.map((format) => (
                    <li key={format.name}>
                      <article>
                        <h3>{format.name}</h3>
                        <p>
                          Status: {format.trackCount}{" "}
                          {format.trackCount === 1 ? "track" : "tracks"}
                        </p>
                        <button
                          onClick={() => {
                            setTrackFormatFilter(format.name);
                            setTrackFolderFilter(undefined);
                            setTrackGenreFilter(undefined);
                            setLibraryView("tracks");
                            setSearchText("");
                            setQuery("");
                            setPageOffset(0);
                            setNotice(
                              `Showing tracks in ${format.name} format from the local catalog.`,
                            );
                          }}
                        >
                          Browse {format.name} tracks
                        </button>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </main>
          ) : libraryView === "folders" ? (
            <main className="folders" aria-labelledby="library-folders">
              <h2 id="library-folders">Folders</h2>
              {folders.length === 0 ? (
                <p>
                  {query
                    ? "No folders match this search."
                    : "The current catalog has no folders."}
                </p>
              ) : (
                <ul>
                  {folders.map((folder) => (
                    <li key={folder.id}>
                      <article>
                        <h3>{folder.path}</h3>
                        <p>
                          Status: {folder.albumCount}{" "}
                          {folder.albumCount === 1 ? "album" : "albums"} ·{" "}
                          {folder.trackCount}{" "}
                          {folder.trackCount === 1 ? "track" : "tracks"}
                        </p>
                        <button
                          onClick={() => {
                            setTrackFolderFilter({
                              id: folder.id,
                              path: folder.path,
                            });
                            setTrackFormatFilter(undefined);
                            setTrackGenreFilter(undefined);
                            setLibraryView("tracks");
                            setSearchText("");
                            setQuery("");
                            setPageOffset(0);
                            setNotice(
                              `Showing tracks in ${folder.path} from the local catalog.`,
                            );
                          }}
                        >
                          Browse tracks in {folder.path}
                        </button>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </main>
          ) : libraryView === "tracks" ? (
            <main className="tracks" aria-labelledby="library-tracks">
              <h2 id="library-tracks">Tracks</h2>
              {tracks.length === 0 ? (
                <p>
                  {query
                    ? "No tracks match this search."
                    : trackFolderFilter
                      ? `No tracks are cataloged in ${trackFolderFilter.path}.`
                      : trackGenreFilter
                        ? trackGenreFilter.missing
                          ? "No tracks are missing a genre tag."
                          : `No tracks use the ${trackGenreFilter.name} genre.`
                        : trackFormatFilter
                          ? `No tracks use ${trackFormatFilter} format.`
                          : "The current catalog has no tracks."}
                </p>
              ) : (
                <div className="track-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Track</th>
                        <th scope="col">Artist</th>
                        <th scope="col">Album</th>
                        <th scope="col">Number</th>
                        <th scope="col">Technical details</th>
                        <th scope="col">File</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracks.map((track) => (
                        <tr key={track.id}>
                          <td>{track.title}</td>
                          <td>{track.artist}</td>
                          <td>
                            {track.albumTitle}
                            <small>{track.albumArtist}</small>
                          </td>
                          <td>
                            Disc {track.discNumber ?? 1}, track{" "}
                            {track.trackNumber ?? "missing"}
                          </td>
                          <td>
                            {track.format} · {track.codec ?? "Unknown codec"}
                            <small>
                              Duration {formatDuration(track.durationSeconds)} ·{" "}
                              {formatBitrate(track.bitrate)} ·{" "}
                              {formatSampleRate(track.sampleRate)} ·{" "}
                              {formatBitDepth(track.bitDepth)} ·{" "}
                              {formatChannels(track.channels)} ·{" "}
                              {formatFileSize(track.size)}
                            </small>
                          </td>
                          <td>{track.path}</td>
                          <td>
                            <button
                              onClick={() => {
                                setAlbumIdFilter(track.albumId);
                                setTrackRouteLabel(track.title);
                                setPendingTrackId(track.id);
                                setTrackFormatFilter(undefined);
                                setTrackFolderFilter(undefined);
                                setTrackGenreFilter(undefined);
                                setAlbumArtistFilter(undefined);
                                setLibraryView("albums");
                                setSearchText("");
                                setQuery("");
                                setPageOffset(0);
                                setNotice(
                                  `Opening ${track.title} in its Library metadata editor.`,
                                );
                              }}
                            >
                              Edit {track.title}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </main>
          ) : albums.length === 0 || !selectedAlbum ? (
            <main className="empty">
              <h2>
                {query
                  ? "No matching albums"
                  : albumArtistFilter
                    ? `No albums by ${albumArtistFilter}`
                    : albumIdFilter
                      ? "The selected track’s album is unavailable"
                      : libraryView === "data-quality"
                        ? "No albums need review"
                        : "Your Library is empty"}
              </h2>
              <p>
                {query
                  ? "Try a different album, artist, track, format, or path."
                  : albumArtistFilter
                    ? "Clear the album-artist filter to return to the full Library."
                    : albumIdFilter
                      ? "The track may have been removed or rescanned. Show all albums to continue browsing."
                      : libraryView === "data-quality"
                        ? qualityFilter === "all"
                          ? "The current catalog has no album data-quality findings."
                          : `No albums have ${diagnosticFilterLabels[qualityFilter].toLowerCase()} findings.`
                        : "Select a folder containing disposable fixtures or files you explicitly intend Outgroove to scan. Scanning and browsing stay offline."}
              </p>
              {!query &&
                !albumArtistFilter &&
                !albumIdFilter &&
                libraryView !== "data-quality" && (
                  <button
                    disabled={busy || scanActive}
                    onClick={() => void chooseAndScan()}
                  >
                    Choose a library folder
                  </button>
                )}
            </main>
          ) : (
            <main
              className={
                libraryAlbumDetailOpen
                  ? "library-album-detail"
                  : "library-album-collection"
              }
            >
              {!libraryAlbumDetailOpen && (
                <LibraryAlbumCollection
                  albums={albums}
                  artworkByAlbum={artworkByAlbum}
                  diagnosticsByAlbum={diagnosticsByAlbum}
                  onOpenAlbum={openLibraryAlbum}
                  registerAlbumTrigger={(albumId, element) => {
                    if (element) albumTriggerRefs.current.set(albumId, element);
                    else albumTriggerRefs.current.delete(albumId);
                  }}
                />
              )}
              {libraryAlbumDetailOpen && (
                <section className="detail album-detail">
                  <nav
                    aria-label="Album detail navigation"
                    className="album-detail-navigation"
                  >
                    <button onClick={closeLibraryAlbum} type="button">
                      Back to albums
                    </button>
                  </nav>
                  <div className="section-heading album-context">
                    <AlbumArtwork
                      album={selectedAlbum}
                      artwork={artworkByAlbum.get(selectedAlbum.id)}
                    />
                    <div>
                      <p className="eyebrow">Album detail</p>
                      <h2 ref={albumDetailHeadingRef} tabIndex={-1}>
                        {selectedAlbum.title}
                      </h2>
                      <p>
                        {selectedAlbum.albumArtist} ·{" "}
                        {selectedAlbumReleaseDate?.status === "consistent"
                          ? selectedAlbumReleaseDate.value
                          : selectedAlbumReleaseDate?.status === "mixed"
                            ? "Mixed release dates"
                            : "Release date not set"}{" "}
                        · {selectedAlbum.tracks.length} tracks
                        {selectedTrack
                          ? ` · Selected: ${selectedTrack.tags.title}`
                          : ""}
                      </p>
                    </div>
                    <div className="actions">
                      <AlbumActionsMenu
                        albumTitle={selectedAlbum.title}
                        busy={busy}
                        syncDisabled={
                          syncAlbums.length >= 100 &&
                          !syncAlbums.some(
                            (album) => album.id === selectedAlbum.id,
                          )
                        }
                        onAddToSync={addSelectedAlbumToSync}
                        onEditMetadata={() =>
                          openLibraryAlbumEditingTool("title")
                        }
                        onEditArtwork={() =>
                          openLibraryAlbumEditingTool("artwork")
                        }
                        onFindMatches={openAlbumIdentification}
                        onEditTrackOrder={() =>
                          openLibraryAlbumEditingTool("sequence")
                        }
                        onOpenHistory={() =>
                          openLibraryAlbumEditingTool("history")
                        }
                      />
                    </div>
                  </div>
                  <section
                    className="card diagnostics"
                    aria-label="Album data quality"
                  >
                    <h3>Album data quality</h3>
                    <p>
                      These checks use only your current Library. They point out
                      possible problems but never guess or apply a correction.
                    </p>
                    {albumDiagnostics.length === 0 ? (
                      <p>Status: No data-quality findings for this album.</p>
                    ) : (
                      <ol className="diagnostic-list">
                        {albumDiagnostics.map((finding) => {
                          const affectedTracks =
                            finding.affectedTrackIds.flatMap((fileId) => {
                              const track = selectedAlbum.tracks.find(
                                (candidate) => candidate.id === fileId,
                              );
                              return track ? [track] : [];
                            });
                          return (
                            <li key={finding.id}>
                              <article
                                aria-labelledby={`diagnostic-${finding.id}`}
                              >
                                <p className="diagnostic-status">
                                  Status:{" "}
                                  {finding.severity === "needs-attention"
                                    ? "Needs attention"
                                    : "Review recommended"}
                                </p>
                                <h4 id={`diagnostic-${finding.id}`}>
                                  {finding.title}
                                </h4>
                                <p>{finding.explanation}</p>
                                <h5>Affected files</h5>
                                <ul>
                                  {affectedTracks.map((track) => (
                                    <li key={track.id}>{track.path}</li>
                                  ))}
                                </ul>
                                <button
                                  disabled={busy}
                                  onClick={() => routeDiagnostic(finding)}
                                >
                                  {diagnosticActionLabel(finding.workflow)}
                                </button>
                              </article>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </section>
                  <section
                    className="album-tracks"
                    aria-labelledby="album-tracks-title"
                  >
                    <div className="track-section-heading">
                      <div>
                        <h3 id="album-tracks-title">Tracks</h3>
                        <p>
                          Select a track to edit its common metadata. Use More
                          for read-only technical information.
                        </p>
                      </div>
                      <span>{selectedAlbum.tracks.length} total</span>
                    </div>
                    <div className="track-list">
                      {selectedAlbum.tracks.map((track) => (
                        <LibraryTrackDetail
                          busy={busy}
                          key={track.id}
                          mode="library"
                          track={track}
                          onEdit={() => editLibraryTrack(track)}
                          onMoreInfo={() => setTechnicalTrackId(track.id)}
                          registerEditTrigger={(element) => {
                            if (element)
                              trackEditTriggerRefs.current.set(
                                track.id,
                                element,
                              );
                            else trackEditTriggerRefs.current.delete(track.id);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                </section>
              )}
            </main>
          )}
          {!libraryOnboardingVisible &&
            !libraryAlbumDetailOpen &&
            totalItems > PAGE_SIZE && (
              <nav className="pagination" aria-label="Library pages">
                <button
                  disabled={pageOffset === 0}
                  onClick={() =>
                    setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))
                  }
                >
                  Previous page
                </button>
                <span>
                  {pageOffset + 1}–
                  {Math.min(pageOffset + PAGE_SIZE, totalItems)} of {totalItems}
                </span>
                <button
                  disabled={pageOffset + PAGE_SIZE >= totalItems}
                  onClick={() => setPageOffset(pageOffset + PAGE_SIZE)}
                >
                  Next page
                </button>
              </nav>
            )}
        </>
      )}
      {activeView === "sync" && (
        <main className="sync-view">
          <section className="sync-workflow-header">
            <div>
              <p className="eyebrow">Copy music to your player</p>
              <h2>Choose, preview, then sync</h2>
              <p>
                Your Library files are never changed. Outgroove shows every
                change to your player before asking you to confirm.
              </p>
            </div>
            <SyncNavigation
              activeStage={syncStage}
              hasActiveProfile={Boolean(profile)}
              recoveryCount={syncRecoveries.length}
              onSelect={setSyncStage}
            />
          </section>
          {syncRecoveries.length > 0 && syncStage !== "recovery" && (
            <section className="sync-recovery-alert" role="alert">
              <div>
                <strong>
                  {syncRecoveries.length} interrupted{" "}
                  {syncRecoveries.length === 1 ? "sync needs" : "syncs need"}{" "}
                  review
                </strong>
                <span>
                  Restoring a backup stays unavailable until{" "}
                  {syncRecoveries.length === 1
                    ? "this sync is"
                    : "these syncs are"}{" "}
                  back in a safe state.
                </span>
              </div>
              <button
                className="primary"
                onClick={() => setSyncStage("recovery")}
              >
                Review recovery
              </button>
            </section>
          )}
          {syncStage === "setup" && (
            <SyncSetupWorkspace
              activeProfileId={profile?.id}
              activeSection={syncSetupSection}
              busy={busy}
              editingProfile={editingSyncProfile}
              profileNameDraft={syncProfileNameDraft}
              profiles={syncProfiles}
              renamingProfileId={renamingSyncProfileId}
              selectedAlbum={selectedAlbum}
              selectedAlbums={syncAlbums}
              removalPreview={syncProfileRemovalPreview}
              removalPreviewHeadingRef={syncProfileRemovalPreviewHeadingRef}
              targetPreview={syncTargetPreview}
              targetPreviewHeadingRef={syncTargetPreviewHeadingRef}
              onBrowseLibrary={() => setActiveView("library")}
              onCancelAlbumSelection={cancelSyncProfileAlbumEdit}
              onCancelRename={cancelSyncProfileRename}
              onCancelTarget={() => {
                setSyncTargetPreview(undefined);
                setNotice("Discarded the DAP target change preview.");
              }}
              onCancelRemoval={() => {
                setSyncProfileRemovalPreview(undefined);
                setNotice("Kept the DAP profile.");
              }}
              onChooseProfileTarget={(saved) =>
                void chooseSyncProfileTarget(saved)
              }
              onChooseTarget={() => void chooseTarget()}
              onClearSelection={() => {
                setSyncAlbums([]);
                setNotice("Cleared the DAP album selection.");
              }}
              onConfirmTarget={() => void applySyncProfileTarget()}
              onConfirmRemoval={() => void applySyncProfileRemoval()}
              onEditProfileAlbums={editSyncProfileAlbums}
              onOpenProfile={openSyncProfile}
              onProfileNameDraftChange={setSyncProfileNameDraft}
              onPreviewRemoval={(saved) =>
                void previewSyncProfileRemoval(saved)
              }
              onRenameProfile={(saved) => void renameSyncProfile(saved)}
              onSaveAlbumSelection={() => void saveSyncProfileAlbums()}
              onSelectSection={setSyncSetupSection}
              onStartRename={startSyncProfileRename}
              onToggleAlbum={toggleSyncAlbum}
            />
          )}
          {syncStage === "review" && profile && (
            <SyncPlanReview
              applyingPlanId={syncApplyingPlanId}
              busy={busy}
              cancellationRequested={syncCancellationRequested}
              cleanupEnabled={syncCleanupEnabled}
              targetVolumeConfirmed={syncTargetVolumeConfirmed}
              editingProfile={editingSyncProfile?.id === profile.id}
              history={syncHistory}
              historyLoading={syncHistoryLoading}
              historyProfileId={syncHistoryProfileId}
              plan={syncPlan}
              planHeadingRef={syncPlanHeadingRef}
              profile={profile}
              onApply={() => void applySync()}
              onCancel={() => void cancelSync()}
              onCleanupEnabledChange={(enabled) => {
                setSyncCleanupEnabled(enabled);
                setSyncPlan(undefined);
                setSyncTargetVolumeConfirmed(false);
                setNotice(
                  enabled
                    ? "Cleanup is enabled only for the next sync preview. Review every proposed removal before confirming."
                    : "Cleanup is disabled. The next preview will not propose removals.",
                );
              }}
              onManage={() => {
                setSyncSetupSection("profiles");
                setSyncStage("setup");
              }}
              onTargetVolumeConfirmedChange={setSyncTargetVolumeConfirmed}
              onPreview={() => void planSync()}
            />
          )}
          {syncStage === "recovery" && (
            <SyncRecoveryWorkspace
              busy={busy}
              feedback={syncRecoveryFeedback}
              feedbackHeadingRef={syncRecoveryFeedbackHeadingRef}
              preview={syncRecoveryPreview}
              previewHeadingRef={syncRecoveryPreviewHeadingRef}
              recoveries={syncRecoveries}
              targetVolumeConfirmed={syncRecoveryTargetVolumeConfirmed}
              onClosePreview={() => {
                setSyncRecoveryPreview(undefined);
                setSyncRecoveryTargetVolumeConfirmed(false);
                setNotice("Closed the recovery review without changing files.");
              }}
              onConfirm={(recovery) => void applySyncRecovery(recovery)}
              onDismissFeedback={() => setSyncRecoveryFeedback(undefined)}
              onReturn={() => setSyncStage("setup")}
              onReview={(recovery) => void reviewSyncRecovery(recovery)}
              onTargetVolumeConfirmedChange={
                setSyncRecoveryTargetVolumeConfirmed
              }
            />
          )}
        </main>
      )}
      {activeView === "settings" && (
        <SettingsView
          activeSection={settingsSection}
          busy={busy}
          libraryRoots={libraryRoots}
          restorePreview={restorePreview}
          rootId={rootId}
          rootRemovalPreview={rootRemovalPreview}
          scanActive={scanActive}
          scanJob={scanJob}
          onAddLibraryFolder={() => void chooseFirstLibraryFolder()}
          onCancelRestore={() => setRestorePreview(undefined)}
          onCancelRootRemoval={() => setRootRemovalPreview(undefined)}
          onConfirmRestore={() => void applyRestore()}
          onConfirmRootRemoval={() => void applyRootRemoval()}
          onCreateBackup={() => void createBackup()}
          onExportDiagnosticReport={() => void exportDiagnosticReport()}
          onPreviewRootRemoval={(selectedRootId) =>
            void previewRootRemoval(selectedRootId)
          }
          onRestoreBackup={() => void chooseRestore()}
          onScanRoot={(selectedRootId) => void startScan(selectedRootId)}
          onSelectSection={setSettingsSection}
        />
      )}
      {activeView === "library" &&
        libraryAlbumDetailOpen &&
        albumIdentificationOpen &&
        selectedAlbum && (
          <AlbumIdentification
            album={selectedAlbum}
            coverArtError={coverArtError}
            coverArtLoading={coverArtLoading}
            coverArtPrepareError={coverArtPrepareError}
            coverArtPreparing={coverArtPreparing}
            coverArtReleaseId={coverArtReleaseId}
            coverArtResult={coverArtResult}
            error={albumIdentificationError}
            loading={albumIdentificationLoading}
            mappingBusy={busy}
            mappingError={musicBrainzMappingError}
            mappingPreview={musicBrainzMappingPreview}
            mappingResult={musicBrainzMappingResult}
            releaseTracksError={releaseTracksError}
            releaseTracksLoading={releaseTracksLoading}
            releaseTracksReleaseId={releaseTracksReleaseId}
            releaseTracksResult={releaseTracksResult}
            result={albumIdentificationResult}
            onCancel={cancelAlbumIdentification}
            onCancelCoverArt={cancelCoverArtArchiveArtwork}
            onCancelMappingPreview={() => {
              setMusicBrainzMappingPreview(undefined);
              setMusicBrainzMappingError(undefined);
            }}
            onCancelReleaseTracks={cancelMusicBrainzReleaseTracks}
            onClose={closeAlbumIdentification}
            onConfirmMapping={() => void applyMusicBrainzTrackMapping()}
            onCreateDraft={createMusicBrainzTagDraft}
            onLoadReleaseTracks={(candidate) =>
              void loadMusicBrainzReleaseTracks(candidate)
            }
            onLoadCoverArt={(candidate) =>
              void loadCoverArtArchiveArtwork(candidate)
            }
            onPrepareCoverArt={(candidate, artworkId) =>
              void prepareCoverArtArchiveReplacement(candidate, artworkId)
            }
            onPreviewMapping={(edits) =>
              void previewMusicBrainzTrackMapping(edits)
            }
            onSearch={() => void searchAlbumIdentification()}
          />
        )}
      {activeView === "library" &&
        libraryAlbumDetailOpen &&
        libraryAlbumEditingTool &&
        selectedAlbum && (
          <ModalSheet
            ariaLabel={`Edit ${selectedAlbum.title}`}
            className="album-editing-sheet"
            closeLabel="Close album editor"
            onClose={() => setLibraryAlbumEditingTool(undefined)}
          >
            <header className="album-editing-heading">
              <p className="eyebrow">Make album changes</p>
              <h2>{selectedAlbum.title}</h2>
              <p>
                Drafts and selections stay local until a fresh preview is
                explicitly confirmed.
              </p>
            </header>
            <LibraryAlbumEditingNavigation
              activeTool={libraryAlbumEditingTool}
              onSelect={(tool) => {
                setAlbumTitleSection(tool === "history" ? "history" : "edit");
                setLibraryAlbumEditingTool(tool);
                if (tool === "history")
                  void refreshEditHistory(selectedAlbum.id);
              }}
            />
            {(libraryAlbumEditingTool === "shared" ||
              libraryAlbumEditingTool === "sequence") && (
              <>
                {renderTrackContext(libraryAlbumEditingTool, (track) => {
                  setLibraryAlbumEditingTool(undefined);
                  editLibraryTrack(track);
                })}
              </>
            )}
            {libraryAlbumEditingTool === "shared" && sharedFieldEditor}
            {libraryAlbumEditingTool === "sequence" && trackOrderEditor}
            {libraryAlbumEditingTool === "artwork" && (
              <AlbumArtworkEditor
                busy={busy}
                error={artworkEditError}
                exportError={artworkExportError}
                exportPreview={artworkExportPreview}
                exportResult={artworkExportResult}
                folderError={folderArtworkError}
                folderPreview={folderArtworkPreview}
                folderResult={folderArtworkResult}
                preview={artworkEditPreview}
                result={artworkEditResult}
                resultAction={artworkEditResultAction}
                onCancelPreview={() => {
                  setArtworkEditPreview(undefined);
                  setArtworkEditError(undefined);
                }}
                onChoose={() => void chooseArtwork()}
                onConfirm={() => void applyArtwork()}
                onExport={() => void exportArtwork()}
                onCancelFolderArtwork={() => {
                  setFolderArtworkPreview(undefined);
                  setFolderArtworkError(undefined);
                }}
                onConfirmFolderArtwork={() => void applyFolderArtwork()}
                onPrepareFolderArtwork={() => void prepareFolderArtwork()}
                onPrepareExport={() => void prepareArtworkExport()}
                onPrepareRemoval={() => void prepareArtworkRemoval()}
              />
            )}
            {(libraryAlbumEditingTool === "title" ||
              libraryAlbumEditingTool === "history") && (
              <>{renderAlbumTitleWorkbench(false)}</>
            )}
          </ModalSheet>
        )}
      {activeView === "library" &&
        libraryAlbumDetailOpen &&
        libraryTrackEditorOpen &&
        selectedTrack && (
          <ModalSheet
            ariaLabel={`Edit metadata for ${selectedTrack.tags.title}`}
            className="track-editor-sheet"
            closeLabel="Close editor"
            onClose={closeTrackEditor}
          >
            <TrackMetadataEditor
              busy={busy || acoustIdBusy}
              draft={trackDraft}
              {...(metadataDraftSource
                ? { draftSource: metadataDraftSource }
                : {})}
              error={trackEditError}
              onCancelPreview={() => {
                setTrackEditPreview(undefined);
                setTrackEditResult(undefined);
                setTrackEditError(undefined);
              }}
              identification={
                <TrackAcoustIdIdentification
                  busy={acoustIdBusy}
                  error={acoustIdError}
                  preview={acoustIdPreview}
                  result={acoustIdResult}
                  track={selectedTrack}
                  onCancel={clearAcoustIdIdentification}
                  onConfirm={() => void confirmAcoustIdIdentification()}
                  onPreview={() => void previewAcoustIdIdentification()}
                  onUseRecordingId={useAcoustIdRecordingId}
                />
              }
              onClose={closeTrackEditor}
              onConfirm={() => void applyTrackEdit()}
              onDraftChange={(field, value) => {
                setTrackDraft((draft) => ({
                  ...draft,
                  [field]: value,
                }));
                setTrackEditPreview(undefined);
                setTrackEditResult(undefined);
                setTrackEditError(undefined);
              }}
              onPreview={() => void previewTrackEdit()}
              preview={trackEditPreview}
              ref={trackEditorRef}
              result={trackEditResult}
              showClose={false}
              track={selectedTrack}
            />
          </ModalSheet>
        )}
      {activeView === "library" && libraryAlbumDetailOpen && technicalTrack && (
        <TrackTechnicalInfo
          onClose={() => setTechnicalTrackId(undefined)}
          track={technicalTrack}
        />
      )}
    </ApplicationShell>
  );
}
