import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DatabaseRestorePreviewDto,
  LibraryArtistDto,
  LibraryFormatDto,
  LibraryFolderDto,
  LibraryGenreDto,
  LibraryRootDto,
  LibraryRootRemovalPreviewDto,
  LibraryTrackDto,
  SavedLibraryFilterDefinition,
  SavedLibraryFilterDto,
  ScanErrorDto,
  ScanJobDto,
  SyncHistoryItemDto,
  SyncRecoveryPreviewDto,
  SyncRecoverySummaryDto,
  SyncPlanDto,
  SyncProfileDto,
  SyncProfileTargetPreviewDto,
  TagEditResultDto,
  TagEditHistoryItemDto,
  TagEditPreviewDto,
  TrackBatchEditPreviewDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
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
import { ActivityView, type ActivityProgress } from "./activity-view";
import {
  AlbumTitleWorkbench,
  type AlbumTitleSection,
  type BatchUndoKind,
} from "./album-title-workbench";
import { ApplicationShell, type AppView } from "./application-shell";
import { LibraryOnboarding } from "./library-onboarding";
import { LibraryTrackDetail } from "./library-track-detail";
import { SharedFieldEditor } from "./shared-field-editor";
import {
  TrackMetadataEditor,
  type TrackMetadataDraft,
} from "./track-metadata-editor";
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
import {
  WorkbenchNavigation,
  type WorkbenchTool,
} from "./workbench-navigation";
import { WorkbenchTrackContext } from "./workbench-track-context";

const PAGE_SIZE = 20;

function draftForTrack(track: CatalogAlbum["tracks"][number]) {
  return {
    title: track.tags.title,
    artist: track.tags.artist,
    albumArtist: track.tags.albumArtist,
    trackNumber: track.tags.trackNumber?.toString() ?? "",
    discNumber: track.tags.discNumber?.toString() ?? "",
    year: track.tags.year ?? "",
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
  const [activeView, setActiveView] = useState<AppView>("library");
  const [workbenchTool, setWorkbenchTool] = useState<WorkbenchTool>("overview");
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
  const [historyError, setHistoryError] = useState<string>();
  const [selectedTrackId, setSelectedTrackId] = useState<string>();
  const [trackDraft, setTrackDraft] = useState<TrackMetadataDraft>({
    title: "",
    artist: "",
    albumArtist: "",
    trackNumber: "",
    discNumber: "",
    year: "",
  });
  const [trackEditPreview, setTrackEditPreview] =
    useState<TrackTagEditPreviewDto>();
  const [trackEditResult, setTrackEditResult] = useState<TagEditResultDto>();
  const [trackEditError, setTrackEditError] = useState<string>();
  const [trackUndoPreview, setTrackUndoPreview] =
    useState<TrackTagEditPreviewDto>();
  const [trackUndoResult, setTrackUndoResult] = useState<TagEditResultDto>();
  const [batchTrackIds, setBatchTrackIds] = useState<string[]>([]);
  const [batchEnabled, setBatchEnabled] = useState({
    artist: false,
    albumArtist: false,
    discNumber: false,
    year: false,
  });
  const [batchDraft, setBatchDraft] = useState({
    artist: "",
    albumArtist: "",
    discNumber: "",
    year: "",
  });
  const [batchPreview, setBatchPreview] = useState<TrackBatchEditPreviewDto>();
  const [batchResult, setBatchResult] = useState<TagEditResultDto>();
  const [sequenceStart, setSequenceStart] = useState("1");
  const [sequenceDiscEnabled, setSequenceDiscEnabled] = useState(false);
  const [sequenceDiscNumber, setSequenceDiscNumber] = useState("1");
  const [sequencePreview, setSequencePreview] =
    useState<TrackBatchEditPreviewDto>();
  const [sequenceResult, setSequenceResult] = useState<TagEditResultDto>();
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
  const [syncRecoveryFeedback, setSyncRecoveryFeedback] =
    useState<SyncRecoveryFeedback>();
  const [syncTargetPreview, setSyncTargetPreview] =
    useState<SyncProfileTargetPreviewDto>();
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    targetPath: string;
    albumIds: readonly string[];
  }>();
  const [syncPlan, setSyncPlan] = useState<SyncPlanDto>();
  const [syncApplyingPlanId, setSyncApplyingPlanId] = useState<string>();
  const [syncCancellationRequested, setSyncCancellationRequested] =
    useState(false);
  const [progress, setProgress] = useState<ActivityProgress>();
  const [scanJob, setScanJob] = useState<ScanJobDto>();
  const [notice, setNotice] = useState("");
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
  const syncRecoveryPreviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const syncRecoveryFeedbackHeadingRef = useRef<HTMLHeadingElement>(null);
  const libraryRequestId = useRef(0);
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
  const albumsWithDiagnostics = useMemo(
    () =>
      albums.filter((album) =>
        Boolean(diagnosticsByAlbum.get(album.id)?.length),
      ).length,
    [albums, diagnosticsByAlbum],
  );

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
  }, [selectedAlbumId]);

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
    } else setNotice(result.error.message);
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

  const refreshEditHistory = useCallback(
    async (albumId: string): Promise<void> => {
      const result = await window.outgroove.listAlbumEditHistory({ albumId });
      if (result.ok) setEditHistory(result.value);
      else setNotice(result.error.message);
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
    } else setNotice(result.error.message);
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
    setNotice(result.error.message);
    return false;
  }, []);

  const refreshSyncProfiles = useCallback(async (): Promise<
    readonly SyncProfileDto[] | undefined
  > => {
    const result = await window.outgroove.listSyncProfiles();
    if (result.ok) {
      setSyncProfiles(result.value);
      return result.value;
    }
    setNotice(result.error.message);
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
      setNotice(result.error.message);
      return false;
    },
    [],
  );

  const refreshSyncRecoveries = useCallback(async (): Promise<void> => {
    const result = await window.outgroove.listSyncRecoveries();
    if (result.ok) {
      setSyncRecoveries(result.value);
      setSyncRecoveryPreview(undefined);
    } else setNotice(result.error.message);
  }, []);

  useEffect(() => window.outgroove.onJobProgress(setProgress), []);
  useEffect(() => {
    const unsubscribe = window.outgroove.onScanJobUpdated((job) => {
      setScanJob(job);
      if (job.state === "completed" && job.result) {
        setNotice(
          `Scan finished: ${job.result.parsed} parsed, ${job.result.unchanged} unchanged, ${job.result.errors} errors.`,
        );
        void refreshLibraryRoots();
        void refreshCatalog();
      } else if (job.state === "cancelled") setNotice(job.detail);
      else if (job.state === "failed" || job.state === "interrupted")
        setNotice(job.error ?? job.detail);
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
      } else setNotice(roots.error.message);
      setLibraryRootsLoaded(true);
      if (latest.ok && latest.value) {
        setScanJob(latest.value);
        if (
          latest.value.state === "failed" ||
          latest.value.state === "interrupted"
        )
          setNotice(latest.value.error ?? latest.value.detail);
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
    setHistoryError(undefined);
    setSelectedTrackId(undefined);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setTrackUndoPreview(undefined);
    setTrackUndoResult(undefined);
    setBatchUndoPreview(undefined);
    setBatchUndoResult(undefined);
    void window.outgroove
      .listAlbumEditHistory({ albumId: selectedAlbumId })
      .then((result) => {
        if (!current) return;
        if (result.ok) setEditHistory(result.value);
        else setNotice(result.error.message);
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
    setActiveView("workbench");
    setWorkbenchTool("track");
    setSelectedTrackId(track.id);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setTrackUndoPreview(undefined);
    setTrackDraft(draftForTrack(track));
    setPendingTrackId(undefined);
    setDiagnosticDestination((current) => ({
      target: "track",
      request: (current?.request ?? 0) + 1,
    }));
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
    setNotice(started.error.message);
    return false;
  };

  const selectLibraryFolder = async (): Promise<LibraryRootDto | undefined> => {
    setLibrarySetupError(undefined);
    const selected = await window.outgroove.chooseLibraryFolder();
    if (!selected.ok) {
      setLibrarySetupError(selected.error.message);
      setNotice(selected.error.message);
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
      else setNotice(result.error.message);
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
        setNotice(result.error.message);
        return;
      }
      setRootRemovalPreview(undefined);
      if (scanJob?.rootId === result.value.rootId) setScanJob(undefined);
      await Promise.all([refreshLibraryRoots(), refreshCatalog()]);
      setNotice(
        `Stopped watching ${rootRemovalPreview.path}. ${result.value.visibleTracksHidden} visible tracks hidden; no audio files deleted.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelScan = async (): Promise<void> => {
    if (!scanJob || !scanActive) return;
    const cancelled = await window.outgroove.cancelScan({ jobId: scanJob.id });
    if (cancelled.ok) setScanJob(cancelled.value);
    else setNotice(cancelled.error.message);
  };

  const createBackup = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.createDatabaseBackup();
      if (!result.ok) setNotice(result.error.message);
      else if (!result.value) setNotice("Database backup cancelled.");
      else
        setNotice(`Database backup verified and saved to ${result.value.path}`);
    } finally {
      setBusy(false);
    }
  };

  const chooseRestore = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.outgroove.chooseDatabaseRestore();
      if (!result.ok) setNotice(result.error.message);
      else if (!result.value) setNotice("Database restore cancelled.");
      else {
        setRestorePreview(result.value);
        setNotice("Backup verified. Review its contents before restoring.");
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
        `Restore verified. Outgroove is restarting. Rollback backup: ${result.value.rollbackBackupPath}`,
      );
    else {
      setBusy(false);
      setNotice(result.error.message);
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
      setNotice(result.error.message);
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
        );
        setEditPreview(undefined);
        setEditTitle("");
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setEditError(result.error.message);
        setNotice(result.error.message);
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
      setNotice(result.error.message);
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
        );
        setUndoPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const editTrack = (track: CatalogAlbum["tracks"][number]): void => {
    setActiveView("workbench");
    setWorkbenchTool("track");
    setSelectedTrackId(track.id);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setTrackUndoPreview(undefined);
    setTrackDraft(draftForTrack(track));
  };

  const routeDiagnostic = (finding: AlbumDiagnostic): void => {
    if (!selectedAlbum) return;
    setActiveView("workbench");
    const affectedIds = [...finding.affectedTrackIds];
    setBatchTrackIds(affectedIds);
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
    let target: "track" | "batch" | "sequence" | "album-title";
    switch (finding.workflow) {
      case "track-editor": {
        const firstTrack = selectedAlbum.tracks.find((track) =>
          affectedIds.includes(track.id),
        );
        if (firstTrack) editTrack(firstTrack);
        target = "track";
        setWorkbenchTool("track");
        break;
      }
      case "sequence":
        target = "sequence";
        setWorkbenchTool("sequence");
        break;
      case "batch-track-artist":
        setBatchEnabled({
          artist: true,
          albumArtist: false,
          discNumber: false,
          year: false,
        });
        setBatchDraft((draft) => ({ ...draft, artist: "" }));
        target = "batch";
        setWorkbenchTool("batch");
        break;
      case "batch-album-artist":
        setBatchEnabled({
          artist: false,
          albumArtist: true,
          discNumber: false,
          year: false,
        });
        setBatchDraft((draft) => ({ ...draft, albumArtist: "" }));
        target = "batch";
        setWorkbenchTool("batch");
        break;
      case "batch-release-date":
        setBatchEnabled({
          artist: false,
          albumArtist: false,
          discNumber: false,
          year: true,
        });
        setBatchDraft((draft) => ({ ...draft, year: "" }));
        target = "batch";
        setWorkbenchTool("batch");
        break;
      case "album-title":
        target = "album-title";
        setAlbumTitleSection("edit");
        setWorkbenchTool("album");
        break;
    }
    setNotice(
      "Affected tracks selected. Review and propose a change in the Workbench; no preview or write has started.",
    );
    setDiagnosticDestination((current) => ({
      target,
      request: (current?.request ?? 0) + 1,
    }));
  };

  const previewTrackEdit = async (): Promise<void> => {
    if (!selectedTrack) return;
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
        discNumber: trackDraft.discNumber
          ? Number(trackDraft.discNumber)
          : null,
        year: trackDraft.year || null,
      },
    });
    if (result.ok) setTrackEditPreview(result.value);
    else {
      setTrackEditError(result.error.message);
      setNotice(result.error.message);
    }
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
        setNotice(
          written?.verified
            ? "Track metadata write was re-read and verified."
            : `Track metadata was not changed: ${written?.error ?? "verification failed"}`,
        );
        if (written?.verified) {
          setTrackEditPreview(undefined);
          await refreshCatalog();
          if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
        }
      } else {
        setTrackEditError(result.error.message);
        setNotice(result.error.message);
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
      setNotice(result.error.message);
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
        );
        if (written?.verified) {
          setTrackUndoPreview(undefined);
          await refreshCatalog();
          if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
        }
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message);
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
    setSequencePreview(undefined);
    setSequenceResult(undefined);
  };

  const selectAllBatchTracks = (): void => {
    if (!selectedAlbum) return;
    setBatchTrackIds(selectedAlbum.tracks.map((track) => track.id));
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
  };

  const clearBatchTracks = (): void => {
    setBatchTrackIds([]);
    setBatchPreview(undefined);
    setBatchResult(undefined);
    setSequencePreview(undefined);
    setSequenceResult(undefined);
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
  };

  const previewBatchEdit = async (): Promise<void> => {
    const changes: {
      artist?: string;
      albumArtist?: string;
      discNumber?: number | null;
      year?: string | null;
    } = {};
    if (batchEnabled.artist) changes.artist = batchDraft.artist;
    if (batchEnabled.albumArtist) changes.albumArtist = batchDraft.albumArtist;
    if (batchEnabled.discNumber)
      changes.discNumber = batchDraft.discNumber
        ? Number(batchDraft.discNumber)
        : null;
    if (batchEnabled.year) changes.year = batchDraft.year || null;
    const result = await window.outgroove.previewTrackBatchEdit({
      fileIds: batchTrackIds,
      changes,
    });
    if (result.ok) {
      setBatchPreview(result.value);
      setBatchResult(undefined);
    } else setNotice(result.error.message);
  };

  const applyBatchEdit = async (): Promise<void> => {
    if (!batchPreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackBatchEdit({
        operationId: batchPreview.operationId,
        confirmationToken: batchPreview.confirmationToken,
      });
      if (result.ok) {
        setBatchResult(result.value);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Re-read and verified ${result.value.results.length} track writes.`
            : `${result.value.results.length - failures.length} writes verified; ${failures.length} failed without stopping the other tracks.`,
        );
        setBatchPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else setNotice(result.error.message);
    } finally {
      setBusy(false);
    }
  };

  const previewTrackNumberSequence = async (): Promise<void> => {
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
    } else setNotice(result.error.message);
  };

  const applyTrackNumberSequence = async (): Promise<void> => {
    if (!sequencePreview) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applyTrackNumberSequence({
        operationId: sequencePreview.operationId,
        confirmationToken: sequencePreview.confirmationToken,
      });
      if (result.ok) {
        setSequenceResult(result.value);
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Re-read and verified ${result.value.results.length} track-number writes.`
            : `${result.value.results.length - failures.length} track numbers verified; ${failures.length} failed without stopping the others.`,
        );
        setSequencePreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else setNotice(result.error.message);
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
      setNotice(result.error.message);
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
        );
        setBatchUndoPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else {
        setHistoryError(result.error.message);
        setNotice(result.error.message);
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
        setNotice(`DAP target selected: ${result.value.targetPath}`);
      }
    } else if (!result.ok) setNotice(result.error.message);
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
        "Exact Workbench album routes cannot be saved as Library filters.",
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
          setNotice(`Saved Library filter “${result.value.name}”.`);
      } else setNotice(result.error.message);
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
          setNotice(`${action} saved Library filter “${result.value.name}”.`);
      } else setNotice(result.error.message);
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
        "Exact Workbench album routes cannot replace a saved Library filter.",
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
          setNotice(`Deleted saved Library filter “${saved.name}”.`);
      } else setNotice(result.error.message);
    } finally {
      setSavedFilterBusy(false);
    }
  };

  const planSync = async (): Promise<void> => {
    if (!profile) return;
    const result = await window.outgroove.planSync({ profileId: profile.id });
    if (result.ok) setSyncPlan(result.value);
    else setNotice(result.error.message);
  };

  const openSyncProfile = (saved: SyncProfileDto): void => {
    setActiveView("sync");
    setSyncStage("review");
    setEditingSyncProfileId(undefined);
    setSyncAlbums([]);
    setProfile(saved);
    setSyncPlan(undefined);
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
    setEditingSyncProfileId(saved.id);
    setSyncAlbums(saved.albums);
    void refreshSyncHistory(saved.id);
    setNotice(
      `Editing albums for DAP profile “${saved.name}”. Add or remove albums in the Workbench, then save the selection.`,
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
          );
        }
      } else setNotice(result.error.message);
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
            `Renamed DAP profile “${saved.name}” to “${result.value.name}”. Its target, albums, manifests, and current sync preview are unchanged.`,
          );
      } else setNotice(result.error.message);
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
        setSyncTargetPreview(result.value);
        setNotice(
          `Review the DAP target change for “${saved.name}”. No files have been changed.`,
        );
      } else if (!result.ok) setNotice(result.error.message);
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
        setSyncTargetPreview(undefined);
        setSyncStage("review");
        setSyncProfiles((current) =>
          current.map((candidate) =>
            candidate.id === result.value.id ? result.value : candidate,
          ),
        );
        await refreshSyncProfiles();
        setNotice(
          `Changed “${result.value.name}” to ${result.value.targetPath}. Existing sync history was preserved; create a fresh preview before applying.`,
        );
      } else setNotice(result.error.message);
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
      });
      if (result.ok) {
        if (result.value.outcome === "completed")
          setNotice(
            `Sync complete: ${result.value.copied} copied and ${result.value.unchanged} unchanged. Manifest written last.${result.value.errors.length > 0 ? ` Internal cleanup needs recovery: ${result.value.errors.join(" ")}` : ""}`,
          );
        else if (result.value.outcome === "cancelled")
          setNotice(
            result.value.errors.length === 0
              ? `Sync cancelled safely after ${result.value.copied} completed ${result.value.copied === 1 ? "copy" : "copies"}; ${result.value.rolledBack} rolled back. No new manifest was committed, and this preview can be retried.`
              : `Sync cancelled after ${result.value.copied} completed ${result.value.copied === 1 ? "copy" : "copies"}, but rollback needs attention. ${result.value.rolledBack} completed ${result.value.rolledBack === 1 ? "copy was" : "copies were"} restored. No new manifest was committed. ${result.value.errors.join(" ")}`,
          );
        else
          setNotice(
            `Sync stopped after rolling back ${result.value.rolledBack} completed ${result.value.rolledBack === 1 ? "copy" : "copies"}. No new manifest was committed, and this preview can be retried. ${result.value.errors.join(" ")}`,
          );
        if (result.value.outcome === "completed") {
          await planSync();
          await refreshSyncHistory(applyingPlan.profileId);
        }
        await refreshSyncRecoveries();
      } else setNotice(result.error.message);
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
      setNotice(result.error.message);
      return;
    }
    if (result.value.accepted) {
      setSyncCancellationRequested(true);
      setNotice(
        "Sync cancellation requested. Outgroove will finish or discard the current temporary copy, then restore files completed by this run.",
      );
    } else if (result.value.state === "finalizing")
      setNotice(
        "The sync is committing its playlist and manifest and can no longer be cancelled safely.",
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
      });
      if (!result.ok) {
        setNotice(result.error.message);
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
            ? `Interrupted sync recovery complete: ${result.value.recovered} ${result.value.recovered === 1 ? "change" : "changes"} restored or removed. You can preview this profile again.`
            : `Interrupted sync recovery complete with notes: ${result.value.errors.join(" ")}`,
        );
      } else
        setNotice(
          `Sync recovery is incomplete. Reconnect the target or resolve the reported files, then review it again. ${result.value.errors.join(" ")}`,
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
    setBusy(true);
    try {
      const result = await window.outgroove.previewSyncRecovery({
        runId: recovery.runId,
      });
      if (result.ok) setSyncRecoveryPreview(result.value);
      else {
        setNotice(result.error.message);
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

  return (
    <ApplicationShell
      activeView={activeView}
      notice={notice}
      onDismissNotice={() => setNotice("")}
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
      {(activeView === "library" || activeView === "workbench") && (
        <>
          {activeView === "library" && !libraryOnboardingVisible && (
            <section className="view-actions" aria-label="Library actions">
              <div>
                <p className="eyebrow">Local collection</p>
                <h2>Browse your Library</h2>
                <p>
                  Search and inspect local metadata. Editing and DAP copies open
                  in their own reviewed workspaces.
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
          )}
          {activeView === "library" && !libraryOnboardingVisible && (
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
                <label htmlFor="library-search">Search Library</label>
                <input
                  id="library-search"
                  type="search"
                  value={searchText}
                  placeholder="Album, artist, genre, track, format, or path"
                  onChange={(event) => setSearchText(event.target.value)}
                />
                <label htmlFor="library-view">View</label>
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
                        "Checking album data quality in a background worker…",
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
                          `Checking ${diagnosticFilterLabels[filter].toLowerCase()} in a background worker…`,
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
              <section
                className="saved-filters"
                aria-labelledby="saved-filters-title"
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Local shortcuts</p>
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
                  Saves the active search and view. Page position and exact
                  Workbench album routes remain temporary.
                </p>
                {albumIdFilter && (
                  <p>Status: Return to a normal Library view before saving.</p>
                )}
                {savedFilters.length === 0 ? (
                  <p>No saved Library filters yet.</p>
                ) : (
                  <ul>
                    {savedFilters.map((saved) => (
                      <li key={saved.id}>
                        <div>
                          <strong>{saved.name}</strong>
                          <span>{describeSavedFilter(saved.definition)}</span>
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
                          disabled={savedFilterBusy || Boolean(albumIdFilter)}
                          onClick={() => void replaceSavedLibraryFilter(saved)}
                        >
                          Update {saved.name} to current filter
                        </button>
                        <button
                          disabled={savedFilterBusy}
                          onClick={() => void deleteSavedLibraryFilter(saved)}
                        >
                          Delete {saved.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
          {activeView === "library" && !libraryOnboardingVisible && (
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
          ) : activeView === "library" && libraryView === "scan-errors" ? (
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
          ) : activeView === "library" && libraryView === "artists" ? (
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
          ) : activeView === "library" && libraryView === "genres" ? (
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
          ) : activeView === "library" && libraryView === "formats" ? (
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
          ) : activeView === "library" && libraryView === "folders" ? (
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
          ) : activeView === "library" && libraryView === "tracks" ? (
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
                                  `Opening ${track.title} in the existing preview-only track editor.`,
                                );
                              }}
                            >
                              Open {track.title} in Workbench
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
                {activeView === "workbench"
                  ? "Choose an album to begin"
                  : query
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
                {activeView === "workbench"
                  ? "Select an album or track in Library, then open its contextual metadata workflow. No preview or write starts automatically."
                  : query
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
              {activeView === "workbench" && (
                <button onClick={() => setActiveView("library")}>
                  Browse Library
                </button>
              )}
              {!query &&
                activeView === "library" &&
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
                activeView === "workbench"
                  ? "workspace workbench-workspace"
                  : "workspace"
              }
            >
              {activeView === "library" && (
                <aside aria-label="Albums">
                  <h2>Albums</h2>
                  <p className="album-quality-summary" aria-live="polite">
                    Albums needing review on this page: {albumsWithDiagnostics}{" "}
                    of {albums.length}.
                  </p>
                  {albums.map((album) => {
                    const findings = diagnosticsByAlbum.get(album.id) ?? [];
                    const needsAttention = findings.some(
                      (finding) => finding.severity === "needs-attention",
                    );
                    return (
                      <button
                        aria-current={
                          album.id === selectedAlbumId ? "true" : undefined
                        }
                        className={
                          album.id === selectedAlbumId
                            ? "album selected"
                            : "album"
                        }
                        key={album.id}
                        onClick={() => {
                          setSelectedAlbumId(album.id);
                          setEditPreview(undefined);
                          setSyncPlan(undefined);
                        }}
                      >
                        {album.title}
                        <small>
                          {album.albumArtist} · {album.tracks.length} tracks
                        </small>
                        <small
                          className={`album-quality-status ${
                            findings.length === 0 ? "clean" : "review"
                          }`}
                        >
                          {findings.length === 0
                            ? "Status: No data-quality findings"
                            : `Status: ${findings.length} data-quality ${findings.length === 1 ? "finding" : "findings"} — ${
                                needsAttention
                                  ? "needs attention"
                                  : "review recommended"
                              }`}
                        </small>
                      </button>
                    );
                  })}
                </aside>
              )}
              <section className="detail">
                <>
                  <div className="section-heading album-context">
                    <div>
                      <p className="eyebrow">
                        {activeView === "workbench"
                          ? "Current album context"
                          : "Album detail"}
                      </p>
                      <h2>{selectedAlbum.title}</h2>
                      <p>
                        {selectedAlbum.albumArtist} ·{" "}
                        {selectedAlbum.tracks.length} tracks
                        {selectedTrack
                          ? ` · Selected: ${selectedTrack.tags.title}`
                          : ""}
                      </p>
                    </div>
                    <div className="actions">
                      {activeView === "library" ? (
                        <>
                          <button
                            className="primary"
                            onClick={() => {
                              setWorkbenchTool("overview");
                              setActiveView("workbench");
                            }}
                          >
                            Open {selectedAlbum.title} in Workbench
                          </button>
                          <button
                            disabled={
                              busy ||
                              (syncAlbums.length >= 100 &&
                                !syncAlbums.some(
                                  (album) => album.id === selectedAlbum.id,
                                ))
                            }
                            onClick={() => {
                              if (
                                !syncAlbums.some(
                                  (album) => album.id === selectedAlbum.id,
                                )
                              )
                                toggleSyncAlbum(selectedAlbum);
                              setSyncStage("setup");
                              setSyncSetupSection("selection");
                              setActiveView("sync");
                            }}
                          >
                            Add {selectedAlbum.title} to Sync
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setActiveView("library")}>
                          Back to Library
                        </button>
                      )}
                    </div>
                  </div>
                  {activeView === "workbench" && (
                    <WorkbenchNavigation
                      activeTool={workbenchTool}
                      selectedTrackTitle={selectedTrack?.tags.title}
                      onSelect={setWorkbenchTool}
                    />
                  )}
                  {(activeView === "library" ||
                    workbenchTool === "overview") && (
                    <section
                      className="card diagnostics"
                      aria-label="Album data quality"
                    >
                      <h3>
                        {activeView === "library"
                          ? "Album data quality"
                          : "Album review"}
                      </h3>
                      <p>
                        Findings come from the current local catalog. They
                        select a review workflow but never infer, preview, or
                        write a correction.
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
                  )}
                  {(activeView === "library" ||
                    workbenchTool === "overview") && (
                    <section
                      className="album-tracks"
                      aria-labelledby="album-tracks-title"
                    >
                      <div className="track-section-heading">
                        <div>
                          <h3 id="album-tracks-title">Tracks</h3>
                          <p>
                            Open a track for technical details. Raw tag data
                            stays in its Advanced metadata disclosure.
                          </p>
                        </div>
                        <span>{selectedAlbum.tracks.length} total</span>
                      </div>
                      <div className="track-list">
                        {selectedAlbum.tracks.map((track) => (
                          <LibraryTrackDetail
                            busy={busy}
                            key={track.id}
                            mode={activeView}
                            selectionPurpose={
                              workbenchTool === "sequence"
                                ? "track ordering"
                                : workbenchTool === "batch"
                                  ? "shared-field editing"
                                  : "shared metadata or track ordering"
                            }
                            selectedForBatch={batchTrackIds.includes(track.id)}
                            track={track}
                            onEdit={() => editTrack(track)}
                            onToggleBatch={() => toggleBatchTrack(track.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {activeView === "workbench" &&
                    (workbenchTool === "batch" ||
                      workbenchTool === "sequence") && (
                      <WorkbenchTrackContext
                        busy={busy}
                        selectedTrackIds={batchTrackIds}
                        selectionPurpose={
                          workbenchTool === "sequence"
                            ? "track ordering"
                            : "shared-field editing"
                        }
                        tracks={selectedAlbum.tracks}
                        onClearSelection={clearBatchTracks}
                        onEditTrack={editTrack}
                        onSelectAll={selectAllBatchTracks}
                        onToggleTrack={toggleBatchTrack}
                      />
                    )}
                  {activeView === "workbench" && workbenchTool === "batch" && (
                    <SharedFieldEditor
                      busy={busy}
                      draft={batchDraft}
                      enabled={batchEnabled}
                      preview={batchPreview}
                      ref={batchEditorRef}
                      result={batchResult}
                      tracks={selectedBatchTracks}
                      onCancelPreview={() => setBatchPreview(undefined)}
                      onConfirm={() => void applyBatchEdit()}
                      onDraftChange={(field, value) => {
                        setBatchDraft((draft) => ({
                          ...draft,
                          [field]: value,
                        }));
                        setBatchPreview(undefined);
                        setBatchResult(undefined);
                      }}
                      onEnabledChange={(field, enabled) => {
                        setBatchEnabled((current) => ({
                          ...current,
                          [field]: enabled,
                        }));
                        setBatchPreview(undefined);
                        setBatchResult(undefined);
                      }}
                      onPreview={() => void previewBatchEdit()}
                    />
                  )}
                  {activeView === "workbench" &&
                    workbenchTool === "sequence" && (
                      <TrackOrderEditor
                        busy={busy}
                        discDraft={sequenceDiscNumber}
                        discEnabled={sequenceDiscEnabled}
                        preview={sequencePreview}
                        ref={sequenceEditorRef}
                        result={sequenceResult}
                        startDraft={sequenceStart}
                        tracks={orderedSequenceTracks}
                        onCancelPreview={() => setSequencePreview(undefined)}
                        onConfirm={() => void applyTrackNumberSequence()}
                        onDiscChange={(value) => {
                          setSequenceDiscNumber(value);
                          setSequencePreview(undefined);
                          setSequenceResult(undefined);
                        }}
                        onDiscEnabledChange={(enabled) => {
                          setSequenceDiscEnabled(enabled);
                          setSequencePreview(undefined);
                          setSequenceResult(undefined);
                        }}
                        onMove={moveBatchTrack}
                        onPreview={() => void previewTrackNumberSequence()}
                        onStartChange={(value) => {
                          setSequenceStart(value);
                          setSequencePreview(undefined);
                          setSequenceResult(undefined);
                        }}
                      />
                    )}
                  {activeView === "workbench" &&
                    workbenchTool === "track" &&
                    selectedTrack && (
                      <TrackMetadataEditor
                        busy={busy}
                        draft={trackDraft}
                        error={trackEditError}
                        onCancelPreview={() => {
                          setTrackEditPreview(undefined);
                          setTrackEditResult(undefined);
                          setTrackEditError(undefined);
                        }}
                        onClose={() => {
                          setSelectedTrackId(undefined);
                          setTrackEditPreview(undefined);
                          setTrackEditResult(undefined);
                          setTrackEditError(undefined);
                        }}
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
                        track={selectedTrack}
                      />
                    )}
                  {activeView === "workbench" && workbenchTool === "album" && (
                    <AlbumTitleWorkbench
                      albumTitle={selectedAlbum.title}
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
                      onPreviewEdit={() => void previewEdit()}
                      onPreviewTrackUndo={(operationId) =>
                        void previewTrackUndo(operationId)
                      }
                      onPreviewUndo={(operationId) =>
                        void previewUndo(operationId)
                      }
                      onSectionChange={setAlbumTitleSection}
                      ref={albumTitleEditorRef}
                      section={albumTitleSection}
                      trackUndoPreview={trackUndoPreview}
                      trackUndoResult={trackUndoResult}
                      undoPreview={undoPreview}
                      undoResult={undoResult}
                    />
                  )}
                </>
              </section>
            </main>
          )}
          {activeView === "library" &&
            !libraryOnboardingVisible &&
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
              <p className="eyebrow">Folder-backed DAP sync</p>
              <h2>Prepare, review, then copy</h2>
              <p>
                Source audio is never modified. Every target plan remains
                preview-only until you explicitly confirm it.
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
                  Database restore remains blocked until pending recovery is
                  completed.
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
              targetPreview={syncTargetPreview}
              targetPreviewHeadingRef={syncTargetPreviewHeadingRef}
              onBrowseLibrary={() => setActiveView("library")}
              onCancelAlbumSelection={cancelSyncProfileAlbumEdit}
              onCancelRename={cancelSyncProfileRename}
              onCancelTarget={() => {
                setSyncTargetPreview(undefined);
                setNotice("Discarded the DAP target change preview.");
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
              onEditProfileAlbums={editSyncProfileAlbums}
              onOpenProfile={openSyncProfile}
              onProfileNameDraftChange={setSyncProfileNameDraft}
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
              editingProfile={editingSyncProfile?.id === profile.id}
              history={syncHistory}
              historyLoading={syncHistoryLoading}
              historyProfileId={syncHistoryProfileId}
              plan={syncPlan}
              planHeadingRef={syncPlanHeadingRef}
              profile={profile}
              onApply={() => void applySync()}
              onCancel={() => void cancelSync()}
              onManage={() => {
                setSyncSetupSection("profiles");
                setSyncStage("setup");
              }}
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
              onClosePreview={() => {
                setSyncRecoveryPreview(undefined);
                setNotice("Closed the recovery review without changing files.");
              }}
              onConfirm={(recovery) => void applySyncRecovery(recovery)}
              onDismissFeedback={() => setSyncRecoveryFeedback(undefined)}
              onReturn={() => setSyncStage("setup")}
              onReview={(recovery) => void reviewSyncRecovery(recovery)}
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
          onPreviewRootRemoval={(selectedRootId) =>
            void previewRootRemoval(selectedRootId)
          }
          onRestoreBackup={() => void chooseRestore()}
          onScanRoot={(selectedRootId) => void startScan(selectedRootId)}
          onSelectSection={setSettingsSection}
        />
      )}
    </ApplicationShell>
  );
}
