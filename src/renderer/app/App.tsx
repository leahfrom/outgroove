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
import { ApplicationShell, type AppView } from "./application-shell";
import { LibraryTrackDetail } from "./library-track-detail";
import {
  TrackMetadataEditor,
  type TrackMetadataDraft,
} from "./track-metadata-editor";
import { SyncNavigation, type SyncStage } from "./sync-navigation";
import {
  WorkbenchNavigation,
  type WorkbenchTool,
} from "./workbench-navigation";

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
  const [rootId, setRootId] = useState<string>();
  const [libraryRoots, setLibraryRoots] = useState<readonly LibraryRootDto[]>(
    [],
  );
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
  const [editTitle, setEditTitle] = useState("");
  const [editPreview, setEditPreview] = useState<TagEditPreviewDto>();
  const [editHistory, setEditHistory] = useState<
    readonly TagEditHistoryItemDto[]
  >([]);
  const [undoPreview, setUndoPreview] = useState<TagEditPreviewDto>();
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
  const [notice, setNotice] = useState(
    "Choose a fixture or test library folder to begin.",
  );
  const [busy, setBusy] = useState(false);
  const [diagnosticDestination, setDiagnosticDestination] = useState<{
    target: "track" | "batch" | "sequence" | "album-title";
    request: number;
  }>();
  const trackEditorRef = useRef<HTMLElement>(null);
  const batchEditorRef = useRef<HTMLElement>(null);
  const sequenceEditorRef = useRef<HTMLDivElement>(null);
  const albumTitleEditorRef = useRef<HTMLElement>(null);
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
    if (!selectedAlbumId) {
      setEditHistory([]);
      return;
    }
    let current = true;
    setEditPreview(undefined);
    setUndoPreview(undefined);
    setSelectedTrackId(undefined);
    setTrackEditPreview(undefined);
    setTrackEditResult(undefined);
    setTrackEditError(undefined);
    setTrackUndoPreview(undefined);
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

  const startScan = async (selectedRootId: string): Promise<void> => {
    setRootId(selectedRootId);
    const started = await window.outgroove.scanLibrary({
      rootId: selectedRootId,
    });
    if (started.ok) {
      setScanJob(started.value);
      setNotice(
        "Scan started. You can cancel it without losing the previous catalog.",
      );
    } else setNotice(started.error.message);
  };

  const chooseAndScan = async (): Promise<void> => {
    setBusy(true);
    try {
      const selected = await window.outgroove.chooseLibraryFolder();
      if (!selected.ok) {
        setNotice(selected.error.message);
        return;
      }
      if (!selected.value) {
        setNotice("Folder selection cancelled.");
        return;
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
      await startScan(selectedRoot.id);
    } finally {
      setBusy(false);
    }
  };

  const rescan = async (): Promise<void> => {
    if (!rootId) return;
    await startScan(rootId);
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
    const result = await window.outgroove.previewAlbumTitleEdit({
      albumId: selectedAlbum.id,
      proposedTitle: editTitle,
    });
    if (result.ok) {
      setUndoPreview(undefined);
      setEditPreview(result.value);
    } else setNotice(result.error.message);
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
      } else setNotice(result.error.message);
    } finally {
      setBusy(false);
    }
  };

  const previewUndo = async (operationId: string): Promise<void> => {
    const result = await window.outgroove.previewAlbumTitleUndo({
      operationId,
    });
    if (result.ok) {
      setEditPreview(undefined);
      setUndoPreview(result.value);
    } else setNotice(result.error.message);
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
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Verified undo for ${result.value.results.length} files.`
            : `${failures.length} files were not undone. Conflicts or verification failures remain visible in history.`,
        );
        setUndoPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else setNotice(result.error.message);
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
    const result = await window.outgroove.previewTrackTagUndo({ operationId });
    if (result.ok) {
      setEditPreview(undefined);
      setUndoPreview(undefined);
      setTrackEditPreview(undefined);
      setTrackEditResult(undefined);
      setTrackEditError(undefined);
      setTrackUndoPreview(result.value);
    } else setNotice(result.error.message);
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
      } else setNotice(result.error.message);
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

  const previewBatchUndo = async (operationId: string): Promise<void> => {
    const result = await window.outgroove.previewTrackBatchUndo({
      operationId,
    });
    if (result.ok) {
      setUndoPreview(undefined);
      setTrackUndoPreview(undefined);
      setBatchResult(undefined);
      setBatchUndoPreview(result.value);
      setBatchUndoResult(undefined);
    } else setNotice(result.error.message);
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
        const failures = result.value.results.filter((item) => !item.verified);
        setNotice(
          failures.length === 0
            ? `Re-read and verified ${result.value.results.length} batch undo writes.`
            : `${result.value.results.length - failures.length} undo writes verified; ${failures.length} refused or failed without stopping the others.`,
        );
        setBatchUndoPreview(undefined);
        await refreshCatalog();
        if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
      } else setNotice(result.error.message);
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

  const toggleSyncAlbum = (album: CatalogAlbum): void => {
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
        return;
      }
      await refreshSyncRecoveries();
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
    setBusy(true);
    try {
      const result = await window.outgroove.previewSyncRecovery({
        runId: recovery.runId,
      });
      if (result.ok) setSyncRecoveryPreview(result.value);
      else setNotice(result.error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ApplicationShell
      activeView={activeView}
      notice={notice}
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
          {activeView === "library" && (
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
          {activeView === "library" && (
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
          {activeView === "library" && (
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
          {activeView === "library" && libraryView === "scan-errors" ? (
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
                    workbenchTool === "overview" ||
                    workbenchTool === "batch" ||
                    workbenchTool === "sequence") && (
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
                      <section
                        className="selection-toolbar"
                        aria-label="Selected tracks"
                      >
                        <div>
                          <p className="eyebrow">Shared selection</p>
                          <h3>
                            {batchTrackIds.length} of{" "}
                            {selectedAlbum.tracks.length} tracks selected
                          </h3>
                          <p>
                            The same selection is kept when you switch between
                            Shared fields and Track order.
                          </p>
                        </div>
                        <div className="actions">
                          <button
                            disabled={busy}
                            onClick={() => {
                              setBatchTrackIds(
                                selectedAlbum.tracks.map((track) => track.id),
                              );
                              setBatchPreview(undefined);
                              setBatchResult(undefined);
                              setSequencePreview(undefined);
                              setSequenceResult(undefined);
                            }}
                          >
                            Select all tracks
                          </button>
                          <button
                            disabled={busy || batchTrackIds.length === 0}
                            onClick={() => {
                              setBatchTrackIds([]);
                              setBatchPreview(undefined);
                              setBatchResult(undefined);
                              setSequencePreview(undefined);
                              setSequenceResult(undefined);
                            }}
                          >
                            Clear selection
                          </button>
                        </div>
                      </section>
                    )}
                  {activeView === "workbench" && workbenchTool === "batch" && (
                    <section
                      className="card"
                      aria-label="Batch metadata editor"
                      ref={batchEditorRef}
                      tabIndex={-1}
                    >
                      <p className="eyebrow">Shared-field workflow</p>
                      <h3>Edit shared metadata</h3>
                      <p>
                        {batchTrackIds.length} tracks selected. Enable only the
                        shared fields you intend to write. Track titles and
                        track numbers stay in the single-track editor.
                      </p>
                      <div className="field-grid">
                        <label>
                          <span>
                            <input
                              type="checkbox"
                              checked={batchEnabled.artist}
                              onChange={(event) => {
                                setBatchEnabled((enabled) => ({
                                  ...enabled,
                                  artist: event.target.checked,
                                }));
                                setBatchPreview(undefined);
                                setBatchResult(undefined);
                              }}
                            />
                            Change track artist
                          </span>
                          <input
                            aria-label="Batch track artist value"
                            disabled={!batchEnabled.artist}
                            value={batchDraft.artist}
                            onChange={(event) => {
                              setBatchDraft((draft) => ({
                                ...draft,
                                artist: event.target.value,
                              }));
                              setBatchPreview(undefined);
                              setBatchResult(undefined);
                            }}
                          />
                        </label>
                        <label>
                          <span>
                            <input
                              type="checkbox"
                              checked={batchEnabled.albumArtist}
                              onChange={(event) => {
                                setBatchEnabled((enabled) => ({
                                  ...enabled,
                                  albumArtist: event.target.checked,
                                }));
                                setBatchPreview(undefined);
                                setBatchResult(undefined);
                              }}
                            />
                            Change album artist
                          </span>
                          <input
                            aria-label="Batch album artist value"
                            disabled={!batchEnabled.albumArtist}
                            value={batchDraft.albumArtist}
                            onChange={(event) => {
                              setBatchDraft((draft) => ({
                                ...draft,
                                albumArtist: event.target.value,
                              }));
                              setBatchPreview(undefined);
                              setBatchResult(undefined);
                            }}
                          />
                        </label>
                        <label>
                          <span>
                            <input
                              type="checkbox"
                              checked={batchEnabled.discNumber}
                              onChange={(event) => {
                                setBatchEnabled((enabled) => ({
                                  ...enabled,
                                  discNumber: event.target.checked,
                                }));
                                setBatchPreview(undefined);
                                setBatchResult(undefined);
                              }}
                            />
                            Change disc number
                          </span>
                          <input
                            aria-label="Batch disc number value"
                            type="number"
                            min="1"
                            max="999"
                            placeholder="Empty clears the value"
                            disabled={!batchEnabled.discNumber}
                            value={batchDraft.discNumber}
                            onChange={(event) => {
                              setBatchDraft((draft) => ({
                                ...draft,
                                discNumber: event.target.value,
                              }));
                              setBatchPreview(undefined);
                              setBatchResult(undefined);
                            }}
                          />
                        </label>
                        <label>
                          <span>
                            <input
                              type="checkbox"
                              checked={batchEnabled.year}
                              onChange={(event) => {
                                setBatchEnabled((enabled) => ({
                                  ...enabled,
                                  year: event.target.checked,
                                }));
                                setBatchPreview(undefined);
                                setBatchResult(undefined);
                              }}
                            />
                            Change release date
                          </span>
                          <input
                            aria-label="Batch release date value"
                            placeholder="YYYY, YYYY-MM, YYYY-MM-DD; empty clears"
                            disabled={!batchEnabled.year}
                            value={batchDraft.year}
                            onChange={(event) => {
                              setBatchDraft((draft) => ({
                                ...draft,
                                year: event.target.value,
                              }));
                              setBatchPreview(undefined);
                              setBatchResult(undefined);
                            }}
                          />
                        </label>
                      </div>
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          batchTrackIds.length < 2 ||
                          !Object.values(batchEnabled).some(Boolean)
                        }
                        onClick={() => void previewBatchEdit()}
                      >
                        Preview selected tracks
                      </button>
                      {batchPreview && (
                        <div
                          className="preview"
                          aria-label="Batch confirmation"
                        >
                          <h4>Per-file review</h4>
                          <p>
                            No file has changed yet. Unchanged tracks will be
                            skipped; every other track is checked again before
                            its write.
                          </p>
                          {batchPreview.files.map((file) => (
                            <div key={file.fileId}>
                              <h5>{file.path}</h5>
                              {!file.willWrite && (
                                <p>Status: unchanged — skipped</p>
                              )}
                              {file.changes.length > 0 && (
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Field</th>
                                      <th>Before</th>
                                      <th>After</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {file.changes.map((change) => (
                                      <tr key={change.field}>
                                        <td>{change.field}</td>
                                        <td>{change.before ?? "Not set"}</td>
                                        <td>{change.after ?? "Not set"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              {file.warnings.map((warning) => (
                                <p key={warning} role="alert">
                                  {warning}
                                </p>
                              ))}
                            </div>
                          ))}
                          <div className="actions">
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                batchPreview.files.some(
                                  (file) =>
                                    file.willWrite && file.warnings.length > 0,
                                )
                              }
                              onClick={() => void applyBatchEdit()}
                            >
                              Confirm and write selected tracks
                            </button>
                            <button onClick={() => setBatchPreview(undefined)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {batchResult && (
                        <div className="preview" aria-live="polite">
                          <h4>Batch write results</h4>
                          <ul>
                            {batchResult.results.map((result) => (
                              <li key={result.fileId}>
                                {result.path}:{" "}
                                {result.verified ? "verified" : "failed"}
                                {result.error ? ` — ${result.error}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                  {activeView === "workbench" &&
                    workbenchTool === "sequence" && (
                      <section
                        className="card sequence-editor"
                        aria-label="Track number sequencing"
                        ref={sequenceEditorRef}
                        tabIndex={-1}
                      >
                        <p className="eyebrow">Track-order workflow</p>
                        <h3>Sequence track numbers</h3>
                        <p>
                          Outgroove uses exactly the order below. Reorder it
                          explicitly before previewing; file names and existing
                          numbers are never used to guess a different order.
                        </p>
                        {batchTrackIds.length === 0 ? (
                          <p>Select at least two tracks above.</p>
                        ) : (
                          <ol>
                            {batchTrackIds.map((fileId, index) => {
                              const track = selectedAlbum.tracks.find(
                                (candidate) => candidate.id === fileId,
                              );
                              return (
                                <li key={fileId}>
                                  <span>{track?.tags.title ?? fileId}</span>
                                  <button
                                    aria-label={`Move ${track?.tags.title ?? "track"} up`}
                                    disabled={busy || index === 0}
                                    onClick={() => moveBatchTrack(fileId, -1)}
                                  >
                                    Move up
                                  </button>
                                  <button
                                    aria-label={`Move ${track?.tags.title ?? "track"} down`}
                                    disabled={
                                      busy || index === batchTrackIds.length - 1
                                    }
                                    onClick={() => moveBatchTrack(fileId, 1)}
                                  >
                                    Move down
                                  </button>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                        <div className="sequence-settings">
                          <label>
                            Starting track number
                            <input
                              type="number"
                              min="1"
                              max="9999"
                              value={sequenceStart}
                              onChange={(event) => {
                                setSequenceStart(event.target.value);
                                setSequencePreview(undefined);
                                setSequenceResult(undefined);
                              }}
                            />
                          </label>
                          <div className="disc-assignment">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={sequenceDiscEnabled}
                                onChange={(event) => {
                                  setSequenceDiscEnabled(event.target.checked);
                                  setSequencePreview(undefined);
                                  setSequenceResult(undefined);
                                }}
                              />
                              Set one disc number for this sequence
                            </label>
                            <label>
                              Sequence disc number
                              <input
                                type="number"
                                min="1"
                                max="999"
                                disabled={!sequenceDiscEnabled}
                                value={sequenceDiscNumber}
                                onChange={(event) => {
                                  setSequenceDiscNumber(event.target.value);
                                  setSequencePreview(undefined);
                                  setSequenceResult(undefined);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            batchTrackIds.length < 2 ||
                            !Number.isInteger(Number(sequenceStart)) ||
                            Number(sequenceStart) < 1 ||
                            Number(sequenceStart) + batchTrackIds.length - 1 >
                              9999 ||
                            (sequenceDiscEnabled &&
                              (!Number.isInteger(Number(sequenceDiscNumber)) ||
                                Number(sequenceDiscNumber) < 1 ||
                                Number(sequenceDiscNumber) > 999))
                          }
                          onClick={() => void previewTrackNumberSequence()}
                        >
                          Preview track-number sequence
                        </button>
                        {sequencePreview && (
                          <div
                            className="preview"
                            aria-label="Track number sequence confirmation"
                          >
                            <h5>Review exact sequence</h5>
                            <ol>
                              {sequencePreview.files.map((file) => (
                                <li key={file.fileId}>
                                  <strong>{file.path}</strong>:{" "}
                                  {file.willWrite ? (
                                    <ul>
                                      {file.changes.map((change) => (
                                        <li key={change.field}>
                                          {change.field}:{" "}
                                          {change.before ?? "Not set"} →{" "}
                                          {change.after ?? "Not set"}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    "unchanged — skipped"
                                  )}
                                  {file.warnings.map((warning) => (
                                    <p key={warning} role="alert">
                                      {warning}
                                    </p>
                                  ))}
                                </li>
                              ))}
                            </ol>
                            <div className="actions">
                              <button
                                className="primary"
                                disabled={
                                  busy ||
                                  sequencePreview.files.some(
                                    (file) =>
                                      file.willWrite &&
                                      file.warnings.length > 0,
                                  )
                                }
                                onClick={() => void applyTrackNumberSequence()}
                              >
                                Confirm track-number sequence
                              </button>
                              <button
                                onClick={() => setSequencePreview(undefined)}
                              >
                                Cancel sequence
                              </button>
                            </div>
                          </div>
                        )}
                        {sequenceResult && (
                          <div className="preview" aria-live="polite">
                            <h5>Track-number results</h5>
                            <ul>
                              {sequenceResult.results.map((result) => (
                                <li key={result.fileId}>
                                  {result.path}:{" "}
                                  {result.verified ? "verified" : "failed"}
                                  {result.error ? ` — ${result.error}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </section>
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
                    <section
                      className="card"
                      aria-label="Album title editor"
                      ref={albumTitleEditorRef}
                      tabIndex={-1}
                    >
                      <h3>Workbench · album title</h3>
                      <label htmlFor="album-title">Proposed title</label>
                      <div className="inline">
                        <input
                          id="album-title"
                          value={editTitle}
                          onChange={(event) => setEditTitle(event.target.value)}
                        />
                        <button
                          disabled={!editTitle.trim() || busy}
                          onClick={() => void previewEdit()}
                        >
                          Preview per-file changes
                        </button>
                      </div>
                      {editPreview && (
                        <div
                          className="preview"
                          aria-label="Tag edit confirmation"
                        >
                          <h4>Review before writing</h4>
                          <p>
                            No file has changed yet. Confirming creates a
                            snapshot, writes a same-volume temporary file,
                            verifies it, and only then replaces the original.
                          </p>
                          <table>
                            <thead>
                              <tr>
                                <th>File</th>
                                <th>Before</th>
                                <th>After</th>
                                <th>Warnings</th>
                              </tr>
                            </thead>
                            <tbody>
                              {editPreview.files.map((file) => (
                                <tr key={file.fileId}>
                                  <td>{file.path}</td>
                                  <td>{file.before}</td>
                                  <td>{file.after}</td>
                                  <td>{file.warnings.join("; ") || "None"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="actions">
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                editPreview.files.some(
                                  (file) => file.warnings.length > 0,
                                )
                              }
                              onClick={() => void applyEdit()}
                            >
                              Confirm and write {editPreview.files.length} files
                            </button>
                            <button onClick={() => setEditPreview(undefined)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      <div
                        className="history"
                        aria-label="Metadata edit history"
                      >
                        <h4>Edit history</h4>
                        {editHistory.length === 0 ? (
                          <p>No confirmed edits for this album yet.</p>
                        ) : (
                          <ol>
                            {editHistory.map((item) => (
                              <li key={item.operationId}>
                                <div>
                                  <strong>
                                    {item.kind === "album-title-edit"
                                      ? `Changed title to “${item.proposedTitle}”`
                                      : item.kind === "album-title-undo"
                                        ? `Restored “${item.proposedTitle}”`
                                        : item.proposedTitle}
                                  </strong>
                                  <span>
                                    {item.state}; {item.verifiedFiles} verified
                                    {item.failedFiles > 0
                                      ? `, ${item.failedFiles} failed`
                                      : ""}{" "}
                                    ·{" "}
                                    <time
                                      dateTime={
                                        item.completedAt ?? item.createdAt
                                      }
                                    >
                                      {new Date(
                                        item.completedAt ?? item.createdAt,
                                      ).toLocaleString()}
                                    </time>
                                  </span>
                                </div>
                                {item.kind === "album-title-edit" &&
                                  item.verifiedFiles > 0 && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void previewUndo(item.operationId)
                                      }
                                    >
                                      Preview undo
                                    </button>
                                  )}
                                {item.kind === "track-tags-edit" &&
                                  item.verifiedFiles > 0 && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void previewTrackUndo(item.operationId)
                                      }
                                    >
                                      Preview track undo
                                    </button>
                                  )}
                                {item.kind === "track-tags-batch-edit" &&
                                  item.verifiedFiles > 0 && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void previewBatchUndo(item.operationId)
                                      }
                                    >
                                      Preview batch undo
                                    </button>
                                  )}
                                {item.kind === "track-number-sequence-edit" &&
                                  item.verifiedFiles > 0 && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void previewBatchUndo(item.operationId)
                                      }
                                    >
                                      Preview sequence undo
                                    </button>
                                  )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      {undoPreview && (
                        <div
                          className="preview"
                          aria-label="Tag undo confirmation"
                        >
                          <h4>Review undo before writing</h4>
                          <p>
                            No file has changed yet. Undo only proceeds when the
                            current album title still matches the verified edit.
                            Each file is snapshotted, safely written, re-read,
                            and verified again.
                          </p>
                          <table>
                            <thead>
                              <tr>
                                <th>File</th>
                                <th>Current</th>
                                <th>Restore</th>
                                <th>Conflicts</th>
                              </tr>
                            </thead>
                            <tbody>
                              {undoPreview.files.map((file) => (
                                <tr key={file.fileId}>
                                  <td>{file.path}</td>
                                  <td>{file.before}</td>
                                  <td>{file.after}</td>
                                  <td>{file.warnings.join("; ") || "None"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="actions">
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                undoPreview.files.some(
                                  (file) => file.warnings.length > 0,
                                )
                              }
                              onClick={() => void applyUndo()}
                            >
                              Confirm and undo {undoPreview.files.length} files
                            </button>
                            <button onClick={() => setUndoPreview(undefined)}>
                              Cancel undo
                            </button>
                          </div>
                        </div>
                      )}
                      {trackUndoPreview && (
                        <div
                          className="preview"
                          aria-label="Track metadata undo confirmation"
                        >
                          <h4>Review track undo before writing</h4>
                          <p>
                            No file has changed yet. Only fields recorded by the
                            original edit will be restored. Undo refuses to
                            overwrite a field changed after that edit.
                          </p>
                          <p>{trackUndoPreview.path}</p>
                          <table>
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>Current</th>
                                <th>Restore</th>
                              </tr>
                            </thead>
                            <tbody>
                              {trackUndoPreview.changes.map((change) => (
                                <tr key={change.field}>
                                  <td>{change.field}</td>
                                  <td>{change.before ?? "Not set"}</td>
                                  <td>{change.after ?? "Not set"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {trackUndoPreview.warnings.map((warning) => (
                            <p key={warning} role="alert">
                              {warning}
                            </p>
                          ))}
                          <div className="actions">
                            <button
                              className="primary"
                              disabled={
                                busy || trackUndoPreview.warnings.length > 0
                              }
                              onClick={() => void applyTrackUndo()}
                            >
                              Confirm and undo track fields
                            </button>
                            <button
                              onClick={() => setTrackUndoPreview(undefined)}
                            >
                              Cancel track undo
                            </button>
                          </div>
                        </div>
                      )}
                      {batchUndoPreview && (
                        <div
                          className="preview"
                          aria-label="Batch metadata undo confirmation"
                        >
                          <h4>Review batch undo before writing</h4>
                          <p>
                            Only fields written by the original batch are
                            restored, and only for files whose original writes
                            were verified. Conflicted files will be refused
                            without stopping safe restores on other files.
                          </p>
                          {batchUndoPreview.files.map((file) => (
                            <div key={file.fileId}>
                              <h5>{file.path}</h5>
                              {!file.willWrite && (
                                <p>Status: already restored — skipped</p>
                              )}
                              {file.changes.length > 0 && (
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Field</th>
                                      <th>Current</th>
                                      <th>Restore</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {file.changes.map((change) => (
                                      <tr key={change.field}>
                                        <td>{change.field}</td>
                                        <td>{change.before ?? "Not set"}</td>
                                        <td>{change.after ?? "Not set"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              {file.warnings.map((warning) => (
                                <p key={warning} role="alert">
                                  {warning}
                                </p>
                              ))}
                            </div>
                          ))}
                          <div className="actions">
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                !batchUndoPreview.files.some(
                                  (file) =>
                                    file.willWrite &&
                                    file.warnings.length === 0,
                                )
                              }
                              onClick={() => void applyBatchUndo()}
                            >
                              Confirm safe batch undo writes
                            </button>
                            <button
                              onClick={() => setBatchUndoPreview(undefined)}
                            >
                              Cancel batch undo
                            </button>
                          </div>
                        </div>
                      )}
                      {batchUndoResult && (
                        <div className="preview" aria-live="polite">
                          <h4>Batch undo results</h4>
                          <ul>
                            {batchUndoResult.results.map((result) => (
                              <li key={result.fileId}>
                                {result.path}:{" "}
                                {result.verified
                                  ? "verified"
                                  : "refused or failed"}
                                {result.error ? ` — ${result.error}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                </>
              </section>
            </main>
          )}
          {activeView === "library" && totalItems > PAGE_SIZE && (
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
                {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, totalItems)}{" "}
                of {totalItems}
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
            <section
              className="card selection-card"
              aria-labelledby="sync-selection"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Copy selection</p>
                  <h2 id="sync-selection">Albums for the next DAP plan</h2>
                  <p>
                    Source audio is never modified. Selecting albums does not
                    inspect or change a target.
                  </p>
                </div>
                {selectedAlbum && (
                  <button
                    disabled={
                      busy ||
                      (syncAlbums.length >= 100 &&
                        !syncAlbums.some(
                          (album) => album.id === selectedAlbum.id,
                        ))
                    }
                    aria-pressed={syncAlbums.some(
                      (album) => album.id === selectedAlbum.id,
                    )}
                    onClick={() => toggleSyncAlbum(selectedAlbum)}
                  >
                    {syncAlbums.some((album) => album.id === selectedAlbum.id)
                      ? `Remove ${selectedAlbum.title}`
                      : `Add ${selectedAlbum.title}`}
                  </button>
                )}
              </div>
              <p aria-live="polite">
                {syncAlbums.length} of 100 albums selected
                {editingSyncProfile
                  ? ` for the ${editingSyncProfile.name} revision.`
                  : "."}
              </p>
              {syncAlbums.length === 0 ? (
                <div className="empty compact">
                  <h3>No albums selected</h3>
                  <p>
                    Choose an album in Library, then use its contextual Sync
                    action.
                  </p>
                  <button onClick={() => setActiveView("library")}>
                    Browse Library
                  </button>
                </div>
              ) : (
                <ul aria-label="Albums selected for DAP sync">
                  {syncAlbums.map((album) => (
                    <li key={album.id}>
                      {album.albumArtist} — {album.title}
                    </li>
                  ))}
                </ul>
              )}
              <div className="actions">
                {editingSyncProfile ? (
                  <>
                    <button
                      disabled={busy || syncAlbums.length === 0}
                      onClick={() => void saveSyncProfileAlbums()}
                    >
                      Save album selection for {editingSyncProfile.name}
                    </button>
                    <button
                      disabled={busy}
                      onClick={cancelSyncProfileAlbumEdit}
                    >
                      Cancel album selection changes
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={busy || syncAlbums.length === 0}
                      onClick={() => void chooseTarget()}
                    >
                      Choose DAP target
                    </button>
                    <button
                      disabled={busy || syncAlbums.length === 0}
                      onClick={() => {
                        setSyncAlbums([]);
                        setNotice("Cleared the DAP album selection.");
                      }}
                    >
                      Clear selection
                    </button>
                  </>
                )}
              </div>
            </section>
          )}
          {syncStage === "setup" && (
            <section className="card settings" aria-labelledby="dap-profiles">
              <h2 id="dap-profiles">DAP profiles</h2>
              <p>
                Saved profiles can be reopened after restarting Outgroove.
                Opening a profile only restores its selection; it does not read
                or change the target until you request a preview. Interrupted
                syncs are detected at startup, but the target is inspected
                read-only only when you review a recovery.
              </p>
              {syncProfiles.length === 0 ? (
                <p>No DAP profiles have been saved yet.</p>
              ) : (
                <ul
                  className="library-root-list"
                  aria-label="Saved DAP profiles"
                >
                  {syncProfiles.map((saved) => (
                    <li key={saved.id}>
                      <div>
                        <strong>{saved.name}</strong>
                        <span>{saved.targetPath}</span>
                        <span>
                          {saved.albums.length} saved{" "}
                          {saved.albums.length === 1 ? "album" : "albums"}:{" "}
                          {saved.albums
                            .map(
                              (album) =>
                                `${album.albumArtist} — ${album.title}`,
                            )
                            .join("; ")}
                        </span>
                      </div>
                      <div className="library-root-actions">
                        <button
                          disabled={busy || Boolean(renamingSyncProfileId)}
                          aria-pressed={profile?.id === saved.id}
                          onClick={() => openSyncProfile(saved)}
                        >
                          Open DAP profile {saved.name}
                        </button>
                        <button
                          disabled={busy || Boolean(renamingSyncProfileId)}
                          onClick={() => editSyncProfileAlbums(saved)}
                        >
                          Edit albums in DAP profile {saved.name}
                        </button>
                        <button
                          disabled={
                            busy ||
                            Boolean(editingSyncProfileId) ||
                            Boolean(renamingSyncProfileId)
                          }
                          onClick={() => void chooseSyncProfileTarget(saved)}
                        >
                          Change DAP target for {saved.name}
                        </button>
                        {renamingSyncProfileId === saved.id ? (
                          <form
                            aria-label={`Rename DAP profile ${saved.name}`}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void renameSyncProfile(saved);
                            }}
                          >
                            <label htmlFor={`sync-profile-name-${saved.id}`}>
                              New name for {saved.name}
                            </label>
                            <input
                              autoFocus
                              id={`sync-profile-name-${saved.id}`}
                              maxLength={100}
                              value={syncProfileNameDraft}
                              onChange={(event) =>
                                setSyncProfileNameDraft(event.target.value)
                              }
                            />
                            <button
                              disabled={
                                busy || syncProfileNameDraft.trim().length === 0
                              }
                              type="submit"
                            >
                              Save DAP profile name
                            </button>
                            <button
                              disabled={busy}
                              type="button"
                              onClick={cancelSyncProfileRename}
                            >
                              Cancel DAP profile rename
                            </button>
                          </form>
                        ) : (
                          <button
                            disabled={
                              busy ||
                              Boolean(editingSyncProfileId) ||
                              Boolean(renamingSyncProfileId)
                            }
                            onClick={() => startSyncProfileRename(saved)}
                          >
                            Rename DAP profile {saved.name}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {syncTargetPreview && (
                <section
                  className="preview"
                  aria-label="DAP target confirmation"
                >
                  <h3>Review DAP target change</h3>
                  <p>
                    <strong>{syncTargetPreview.profileName}</strong>
                  </p>
                  <p>Current target: {syncTargetPreview.currentTargetPath}</p>
                  <p>New target: {syncTargetPreview.proposedTargetPath}</p>
                  <p>
                    This changes only the saved profile. No source audio or
                    target files will be read, copied, replaced, or deleted.
                    Existing sync history stays attached to the profile. A fresh
                    sync preview will treat ownership separately for this
                    target.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void applySyncProfileTarget()}
                  >
                    Confirm DAP target change
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSyncTargetPreview(undefined);
                      setNotice("Discarded the DAP target change preview.");
                    }}
                  >
                    Cancel DAP target change
                  </button>
                </section>
              )}
            </section>
          )}
          {syncStage === "review" && (
            <section
              className="card settings sync-review"
              aria-labelledby="sync-review-title"
            >
              <p className="eyebrow">Preview and apply</p>
              <h2 id="sync-review-title">Review the active DAP profile</h2>
              {profile && (
                <div
                  className="sync-profile-summary"
                  aria-label="Active DAP profile"
                >
                  <p>
                    <strong>{profile.name}</strong>
                    <br />
                    {profile.targetPath}
                  </p>
                  <p>
                    Status: {profile.albumIds.length} selected{" "}
                    {profile.albumIds.length === 1 ? "album" : "albums"} saved
                    in this profile.
                  </p>
                  {editingSyncProfile?.id === profile.id && (
                    <p>Status: Album-selection changes are not saved yet.</p>
                  )}
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={busy || editingSyncProfile?.id === profile.id}
                      onClick={() => void planSync()}
                    >
                      Preview sync plan
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setSyncStage("setup")}
                    >
                      Manage {profile.name}
                    </button>
                  </div>
                  <section
                    aria-labelledby={`sync-history-${profile.id}`}
                    className="sync-history"
                  >
                    <h3 id={`sync-history-${profile.id}`}>
                      Successful sync history
                    </h3>
                    <p>
                      Shows only runs whose manifest was committed successfully.
                      The 20 newest runs are shown in this view.
                    </p>
                    {syncHistoryProfileId !== profile.id ||
                    syncHistoryLoading ? (
                      <p aria-live="polite">Loading successful sync history…</p>
                    ) : syncHistory.length === 0 ? (
                      <p>No successful sync runs have been recorded yet.</p>
                    ) : (
                      <ul
                        aria-label={`Successful sync history for ${profile.name}`}
                      >
                        {syncHistory.map((item) => (
                          <li key={item.id}>
                            <time dateTime={item.completedAt}>
                              {new Date(item.completedAt).toLocaleString()}
                            </time>
                            {" — "}
                            {item.entryCount}{" "}
                            {item.entryCount === 1 ? "file" : "files"}
                            {" — "}
                            {item.targetPath}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
              {syncPlan && (
                <div className="preview" aria-label="Sync confirmation">
                  <h3>Sync preview</h3>
                  <PlanGroup
                    title="Copies"
                    items={syncPlan.copies.map(
                      (item) => item.relativeDestination,
                    )}
                  />
                  <PlanGroup
                    title="Unchanged / skipped"
                    items={syncPlan.unchanged.map(
                      (item) => item.relativeDestination,
                    )}
                  />
                  <PlanGroup title="Conflicts" items={syncPlan.conflicts} />
                  <PlanGroup title="Errors" items={syncPlan.errors} />
                  <p>{syncPlan.requiredBytes} bytes required.</p>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      syncPlan.conflicts.length > 0 ||
                      syncPlan.errors.length > 0
                    }
                    onClick={() => void applySync()}
                  >
                    Confirm and apply copy plan
                  </button>
                  {syncApplyingPlanId === syncPlan.id && (
                    <div aria-live="polite">
                      <p>
                        Status:{" "}
                        {syncCancellationRequested
                          ? "Cancelling safely"
                          : "Sync in progress"}
                      </p>
                      <button
                        disabled={syncCancellationRequested}
                        onClick={() => void cancelSync()}
                      >
                        Cancel active sync
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          {syncStage === "recovery" && (
            <section
              className="card settings sync-recovery"
              aria-labelledby="sync-recovery-title"
            >
              <p className="eyebrow">Restart safety</p>
              <h2 id="sync-recovery-title">Interrupted sync recovery</h2>
              <p>
                Review every target action before confirming. Recovery never
                changes source audio and leaves files with unexpected contents
                untouched.
              </p>
              {syncRecoveries.length === 0 ? (
                <div className="empty compact">
                  <h3>No recovery is pending</h3>
                  <p>
                    Outgroove has no interrupted target changes requiring
                    review.
                  </p>
                  <button onClick={() => setSyncStage("setup")}>
                    Return to albums and profiles
                  </button>
                </div>
              ) : (
                <ul
                  className="sync-recovery-list"
                  aria-label="Interrupted sync recoveries"
                >
                  {syncRecoveries.map((recovery) => (
                    <li key={recovery.runId}>
                      <div>
                        <strong>{recovery.profileName}</strong>
                        <span>
                          {recovery.mode === "committed-cleanup"
                            ? "Sync committed; internal cleanup was interrupted"
                            : `Interrupted during ${recovery.phase}`}
                        </span>
                        <span>{recovery.targetPath}</span>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => void reviewSyncRecovery(recovery)}
                      >
                        Review recovery for {recovery.profileName}
                      </button>
                      {syncRecoveryPreview?.runId === recovery.runId && (
                        <section
                          className="preview"
                          aria-label={`Recovery confirmation for ${recovery.profileName}`}
                        >
                          <h3>Exact recovery actions</h3>
                          {syncRecoveryPreview.actions.length === 0 ? (
                            <p>No target changes can currently be applied.</p>
                          ) : (
                            <ul
                              aria-label={`Recovery actions for ${recovery.profileName}`}
                            >
                              {syncRecoveryPreview.actions.map((action) => (
                                <li key={`${action.action}:${action.path}`}>
                                  {action.action === "restore"
                                    ? "Restore"
                                    : "Remove"}
                                  : {action.path}. {action.explanation}
                                </li>
                              ))}
                            </ul>
                          )}
                          {syncRecoveryPreview.warnings.map((warning) => (
                            <p key={warning} role="alert">
                              Warning: {warning}
                            </p>
                          ))}
                          <button
                            className="primary"
                            disabled={busy || !syncRecoveryPreview.canRecover}
                            onClick={() =>
                              void applySyncRecovery(syncRecoveryPreview)
                            }
                          >
                            Confirm recovery for {recovery.profileName}
                          </button>
                        </section>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </main>
      )}
      {activeView === "settings" && (
        <main className="settings-view">
          <section
            className="card settings"
            aria-labelledby="watched-library-folders"
          >
            <h2 id="watched-library-folders">Watched Library folders</h2>
            <p>
              Outgroove scans only folders you explicitly choose. Rescanning
              reads that folder through the existing incremental scan and never
              changes audio files.
            </p>
            {libraryRoots.length === 0 ? (
              <p>No Library folders have been chosen yet.</p>
            ) : (
              <ul className="library-root-list">
                {libraryRoots.map((root) => {
                  const isCurrent = root.id === rootId;
                  const isScanning = scanActive && scanJob.rootId === root.id;
                  return (
                    <li key={root.id}>
                      <div>
                        <strong>{root.path}</strong>
                        <span>
                          Status: {isScanning ? "Scan in progress" : null}
                          {isScanning && root.lastScanAt ? " · " : null}
                          {root.lastScanAt ? (
                            <>
                              Last scanned{" "}
                              <time dateTime={root.lastScanAt}>
                                {new Date(root.lastScanAt).toLocaleString()}
                              </time>
                            </>
                          ) : isScanning ? null : (
                            "Never scanned"
                          )}
                        </span>
                        {isCurrent && <span>Current scan target</span>}
                      </div>
                      <div className="library-root-actions">
                        <button
                          disabled={busy || scanActive}
                          onClick={() => void startScan(root.id)}
                        >
                          Scan folder {root.path}
                        </button>
                        <button
                          disabled={busy || scanActive}
                          onClick={() => void previewRootRemoval(root.id)}
                        >
                          Stop watching {root.path}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {rootRemovalPreview && (
              <div
                className="preview"
                aria-label="Library folder removal preview"
              >
                <h3>Stop watching this Library folder?</h3>
                <p>
                  <strong>{rootRemovalPreview.path}</strong>
                </p>
                <dl>
                  <dt>Visible tracks hidden</dt>
                  <dd>{rootRemovalPreview.visibleTracks}</dd>
                  <dt>Albums no longer visible</dt>
                  <dd>{rootRemovalPreview.albumsHidden}</dd>
                  <dt>Scan problems hidden</dt>
                  <dd>{rootRemovalPreview.scanProblemsHidden}</dd>
                </dl>
                <p>
                  <strong>No audio or DAP files will be deleted.</strong>{" "}
                  Catalog identities, edit history, DAP profiles, sync
                  manifests, and scan history are retained. Choosing this folder
                  again reuses its catalog identity and requires a rescan before
                  tracks reappear.
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || scanActive}
                    onClick={() => void applyRootRemoval()}
                  >
                    Confirm stop watching
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setRootRemovalPreview(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
          <section className="card settings" aria-labelledby="database-safety">
            <h2 id="database-safety">Database safety</h2>
            <p>
              Backups contain the local catalog, edit history, and DAP profiles,
              but never copy or change audio files.
            </p>
            <div className="actions">
              <button
                disabled={busy || scanActive}
                onClick={() => void createBackup()}
              >
                Create database backup
              </button>
              <button
                disabled={busy || scanActive}
                onClick={() => void chooseRestore()}
              >
                Restore from backup
              </button>
            </div>
            {restorePreview && (
              <div
                className="preview"
                aria-label="Database restore confirmation"
              >
                <h3>Review database replacement</h3>
                <p>
                  <strong>{restorePreview.sourceName}</strong> passed integrity
                  and schema checks. Restoring replaces the current Outgroove
                  database and restarts the app. Source audio and DAP files are
                  untouched.
                </p>
                <dl>
                  <dt>Library roots</dt>
                  <dd>{restorePreview.summary.libraryRoots}</dd>
                  <dt>Albums</dt>
                  <dd>{restorePreview.summary.albums}</dd>
                  <dt>Tracks</dt>
                  <dd>{restorePreview.summary.tracks}</dd>
                  <dt>DAP profiles</dt>
                  <dd>{restorePreview.summary.syncProfiles}</dd>
                  <dt>Saved Library filters</dt>
                  <dd>{restorePreview.summary.savedLibraryFilters}</dd>
                  <dt>Schema</dt>
                  <dd>Version {restorePreview.schemaVersion}</dd>
                </dl>
                <p>
                  Outgroove creates and verifies an automatic rollback backup
                  before replacing anything.
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || scanActive}
                    onClick={() => void applyRestore()}
                  >
                    Confirm restore and restart
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setRestorePreview(undefined)}
                  >
                    Cancel restore
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      )}
    </ApplicationShell>
  );
}

function PlanGroup({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}): React.JSX.Element {
  return (
    <section>
      <h5>
        {title} ({items.length})
      </h5>
      {items.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
