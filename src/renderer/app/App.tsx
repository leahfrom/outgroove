import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DatabaseRestorePreviewDto,
  ScanErrorDto,
  ScanJobDto,
  SyncPlanDto,
  TagEditResultDto,
  TagEditHistoryItemDto,
  TagEditPreviewDto,
  TrackBatchEditPreviewDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  albumDiagnosticFilters,
  diagnoseAlbum,
  isAlbumDiagnosticFilter,
  type AlbumDiagnostic,
  type AlbumDiagnosticFilter,
  type AlbumDiagnosticWorkflow,
} from "../../shared/domain/album-diagnostics";

interface Progress {
  job: "scan" | "tag-edit" | "sync" | "library-quality";
  completed: number;
  total: number;
  detail: string;
}

const PAGE_SIZE = 20;

const diagnosticFilterLabels: Record<AlbumDiagnosticFilter, string> = {
  all: "All findings",
  numbering: "Numbering",
  consistency: "Artist/date consistency",
  "missing-tags": "Missing/placeholder tags",
};

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
  const [rootId, setRootId] = useState<string>();
  const [albums, setAlbums] = useState<readonly CatalogAlbum[]>([]);
  const [scanErrors, setScanErrors] = useState<readonly ScanErrorDto[]>([]);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [libraryView, setLibraryView] = useState<
    "albums" | "data-quality" | "scan-errors"
  >("albums");
  const [qualityFilter, setQualityFilter] =
    useState<AlbumDiagnosticFilter>("all");
  const [pageOffset, setPageOffset] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [restorePreview, setRestorePreview] =
    useState<DatabaseRestorePreviewDto>();
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>();
  const [editTitle, setEditTitle] = useState("");
  const [editPreview, setEditPreview] = useState<TagEditPreviewDto>();
  const [editHistory, setEditHistory] = useState<
    readonly TagEditHistoryItemDto[]
  >([]);
  const [undoPreview, setUndoPreview] = useState<TagEditPreviewDto>();
  const [selectedTrackId, setSelectedTrackId] = useState<string>();
  const [trackDraft, setTrackDraft] = useState({
    title: "",
    artist: "",
    albumArtist: "",
    trackNumber: "",
    discNumber: "",
    year: "",
  });
  const [trackEditPreview, setTrackEditPreview] =
    useState<TrackTagEditPreviewDto>();
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
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    targetPath: string;
  }>();
  const [syncPlan, setSyncPlan] = useState<SyncPlanDto>();
  const [progress, setProgress] = useState<Progress>();
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
      setScanErrors(result.value.scanErrors);
      setTotalItems(result.value.totalItems);
      setSelectedAlbumId((current) =>
        current && result.value.albums.some((album) => album.id === current)
          ? current
          : result.value.albums[0]?.id,
      );
    } else setNotice(result.error.message);
  }, [libraryView, pageOffset, qualityFilter, query]);

  const refreshEditHistory = useCallback(
    async (albumId: string): Promise<void> => {
      const result = await window.outgroove.listAlbumEditHistory({ albumId });
      if (result.ok) setEditHistory(result.value);
      else setNotice(result.error.message);
    },
    [],
  );

  useEffect(() => window.outgroove.onJobProgress(setProgress), []);
  useEffect(() => {
    const unsubscribe = window.outgroove.onScanJobUpdated((job) => {
      setScanJob(job);
      if (job.state === "completed" && job.result) {
        setNotice(
          `Scan finished: ${job.result.parsed} parsed, ${job.result.unchanged} unchanged, ${job.result.errors} errors.`,
        );
        void refreshCatalog();
      } else if (job.state === "cancelled") setNotice(job.detail);
      else if (job.state === "failed" || job.state === "interrupted")
        setNotice(job.error ?? job.detail);
    });
    void Promise.all([
      window.outgroove.listLibraryRoots(),
      window.outgroove.getLatestScanJob(),
    ]).then(([roots, latest]) => {
      if (roots.ok)
        setRootId(
          latest.ok && latest.value ? latest.value.rootId : roots.value[0]?.id,
        );
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
  }, [refreshCatalog]);
  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);
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

  const startScan = async (selectedRootId: string): Promise<void> => {
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
      setRootId(selected.value.id);
      await startScan(selected.value.id);
    } finally {
      setBusy(false);
    }
  };

  const rescan = async (): Promise<void> => {
    if (!rootId) return;
    await startScan(rootId);
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
    setSelectedTrackId(track.id);
    setTrackEditPreview(undefined);
    setTrackUndoPreview(undefined);
    setTrackDraft({
      title: track.tags.title,
      artist: track.tags.artist,
      albumArtist: track.tags.albumArtist,
      trackNumber: track.tags.trackNumber?.toString() ?? "",
      discNumber: track.tags.discNumber?.toString() ?? "",
      year: track.tags.year ?? "",
    });
  };

  const routeDiagnostic = (finding: AlbumDiagnostic): void => {
    if (!selectedAlbum) return;
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
        break;
      }
      case "sequence":
        target = "sequence";
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
        break;
      case "album-title":
        target = "album-title";
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
    else setNotice(result.error.message);
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
        const written = result.value.results[0];
        setNotice(
          written?.verified
            ? "Track metadata write was re-read and verified."
            : `Track metadata was not changed: ${written?.error ?? "verification failed"}`,
        );
        if (written?.verified) {
          setTrackEditPreview(undefined);
          setSelectedTrackId(undefined);
          await refreshCatalog();
          if (selectedAlbum) await refreshEditHistory(selectedAlbum.id);
        }
      } else setNotice(result.error.message);
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
    if (!selectedAlbum) return;
    const result = await window.outgroove.chooseSyncTargetAndCreateProfile({
      name: `${selectedAlbum.title} test DAP`,
      albumId: selectedAlbum.id,
    });
    if (result.ok && result.value) {
      setProfile(result.value);
      setSyncPlan(undefined);
      setNotice(`DAP target selected: ${result.value.targetPath}`);
    } else if (!result.ok) setNotice(result.error.message);
  };

  const planSync = async (): Promise<void> => {
    if (!profile) return;
    const result = await window.outgroove.planSync({ profileId: profile.id });
    if (result.ok) setSyncPlan(result.value);
    else setNotice(result.error.message);
  };

  const applySync = async (): Promise<void> => {
    if (!syncPlan) return;
    setBusy(true);
    try {
      const result = await window.outgroove.applySync({
        planId: syncPlan.id,
        confirmationToken: syncPlan.confirmationToken,
      });
      if (result.ok) {
        setNotice(
          result.value.errors.length === 0
            ? `Sync complete: ${result.value.copied} copied and ${result.value.unchanged} unchanged. Manifest written last.`
            : `Sync stopped: ${result.value.errors.join(" ")}`,
        );
        if (result.value.errors.length === 0) await planSync();
      } else setNotice(result.error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <header>
        <div>
          <p className="eyebrow">Local-first music library</p>
          <h1>Outgroove</h1>
        </div>
        <div className="actions">
          <button
            disabled={busy || scanActive}
            onClick={() => void chooseAndScan()}
          >
            Choose library folder
          </button>
          <button
            disabled={busy || scanActive || !rootId}
            onClick={() => void rescan()}
          >
            Scan again
          </button>
        </div>
      </header>
      <p className="notice" role="status">
        {notice}
      </p>
      {progress && progress.completed < progress.total && (
        <div className="progress" aria-label={`${progress.job} progress`}>
          <progress value={progress.completed} max={progress.total} />
          <span>
            {progress.completed}/{progress.total}: {progress.detail}
          </span>
        </div>
      )}
      {scanJob && (
        <section className="scan-job" aria-label="Scan activity">
          <div>
            <strong>Library scan: {scanJob.state}</strong>
            <span>{scanJob.detail || "Waiting to start…"}</span>
            {scanJob.error && <span role="alert">{scanJob.error}</span>}
          </div>
          {scanJob.state === "running" && scanJob.total === 0 ? (
            <progress aria-label="Discovering audio files" />
          ) : scanJob.total > 0 ? (
            <progress
              aria-label="Reading audio metadata"
              value={scanJob.completed}
              max={scanJob.total}
            />
          ) : null}
          {scanActive && (
            <button
              disabled={scanJob.state === "cancelling"}
              onClick={() => void cancelScan()}
            >
              {scanJob.state === "cancelling" ? "Cancelling…" : "Cancel scan"}
            </button>
          )}
          {(scanJob.state === "cancelled" ||
            scanJob.state === "failed" ||
            scanJob.state === "interrupted") && (
            <button disabled={!rootId} onClick={() => void rescan()}>
              Retry scan
            </button>
          )}
        </section>
      )}
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
          placeholder="Album, artist, track, format, or path"
          onChange={(event) => setSearchText(event.target.value)}
        />
        <label htmlFor="library-view">View</label>
        <select
          id="library-view"
          value={libraryView}
          onChange={(event) => {
            const view = event.target.value as
              "albums" | "data-quality" | "scan-errors";
            setLibraryView(view);
            setPageOffset(0);
            if (view === "data-quality")
              setNotice("Checking album data quality in a background worker…");
          }}
        >
          <option value="albums">Albums</option>
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
      </form>
      <p className="result-count" aria-live="polite">
        {totalItems}{" "}
        {libraryView === "scan-errors"
          ? totalItems === 1
            ? "scan problem"
            : "scan problems"
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
      </p>
      {libraryView === "scan-errors" ? (
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
      ) : albums.length === 0 ? (
        <main className="empty">
          <h2>
            {query
              ? "No matching albums"
              : libraryView === "data-quality"
                ? "No albums need review"
                : "Your Library is empty"}
          </h2>
          <p>
            {query
              ? "Try a different album, artist, track, format, or path."
              : libraryView === "data-quality"
                ? qualityFilter === "all"
                  ? "The current catalog has no album data-quality findings."
                  : `No albums have ${diagnosticFilterLabels[qualityFilter].toLowerCase()} findings.`
                : "Select a folder containing disposable fixtures or files you explicitly intend Outgroove to scan. Scanning and browsing stay offline."}
          </p>
          {!query && libraryView !== "data-quality" && (
            <button
              disabled={busy || scanActive}
              onClick={() => void chooseAndScan()}
            >
              Choose a library folder
            </button>
          )}
        </main>
      ) : (
        <main className="workspace">
          <aside aria-label="Albums">
            <h2>Albums</h2>
            <p className="album-quality-summary" aria-live="polite">
              Albums needing review on this page: {albumsWithDiagnostics} of{" "}
              {albums.length}.
            </p>
            {albums.map((album) => {
              const findings = diagnosticsByAlbum.get(album.id) ?? [];
              const needsAttention = findings.some(
                (finding) => finding.severity === "needs-attention",
              );
              return (
                <button
                  className={
                    album.id === selectedAlbumId ? "album selected" : "album"
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
          <section className="detail">
            {selectedAlbum && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Album detail</p>
                    <h2>{selectedAlbum.title}</h2>
                    <p>{selectedAlbum.albumArtist}</p>
                  </div>
                </div>
                <section
                  className="card diagnostics"
                  aria-label="Album data quality"
                >
                  <h3>Workbench · album data quality</h3>
                  <p>
                    Findings come from the current local catalog. They select a
                    review workflow but never infer, preview, or write a
                    correction.
                  </p>
                  {albumDiagnostics.length === 0 ? (
                    <p>Status: No data-quality findings for this album.</p>
                  ) : (
                    <ol className="diagnostic-list">
                      {albumDiagnostics.map((finding) => {
                        const affectedTracks = finding.affectedTrackIds.flatMap(
                          (fileId) => {
                            const track = selectedAlbum.tracks.find(
                              (candidate) => candidate.id === fileId,
                            );
                            return track ? [track] : [];
                          },
                        );
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
                <div className="track-list">
                  {selectedAlbum.tracks.map((track) => (
                    <details key={track.id}>
                      <summary>
                        <span>
                          {track.tags.discNumber ?? 1}.
                          {track.tags.trackNumber ?? "—"} {track.tags.title}
                        </span>
                        <span>
                          {track.format} ·{" "}
                          {track.durationSeconds?.toFixed(1) ?? "—"}s
                        </span>
                      </summary>
                      <dl>
                        <dt>Path</dt>
                        <dd>{track.path}</dd>
                        <dt>Normalized tags</dt>
                        <dd>
                          <pre>{JSON.stringify(track.tags, null, 2)}</pre>
                        </dd>
                        <dt>Native tags</dt>
                        <dd>
                          <pre>{JSON.stringify(track.nativeTags, null, 2)}</pre>
                        </dd>
                      </dl>
                      <label>
                        <input
                          type="checkbox"
                          checked={batchTrackIds.includes(track.id)}
                          onChange={() => toggleBatchTrack(track.id)}
                        />
                        Select {track.tags.title} for batch edit
                      </label>
                      <button disabled={busy} onClick={() => editTrack(track)}>
                        Edit track metadata
                      </button>
                    </details>
                  ))}
                </div>
                <section
                  className="card"
                  aria-label="Batch metadata editor"
                  ref={batchEditorRef}
                  tabIndex={-1}
                >
                  <h3>Workbench · batch metadata</h3>
                  <p>
                    {batchTrackIds.length} tracks selected. Enable only the
                    shared fields you intend to write. Track titles and track
                    numbers stay in the single-track editor.
                  </p>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setBatchTrackIds(
                          selectedAlbum.tracks.map((track) => track.id),
                        );
                        setBatchPreview(undefined);
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
                        setSequencePreview(undefined);
                        setSequenceResult(undefined);
                      }}
                    >
                      Clear selection
                    </button>
                  </div>
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
                          }}
                        />
                        Change track artist
                      </span>
                      <input
                        aria-label="Batch track artist value"
                        disabled={!batchEnabled.artist}
                        value={batchDraft.artist}
                        onChange={(event) =>
                          setBatchDraft((draft) => ({
                            ...draft,
                            artist: event.target.value,
                          }))
                        }
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
                          }}
                        />
                        Change album artist
                      </span>
                      <input
                        aria-label="Batch album artist value"
                        disabled={!batchEnabled.albumArtist}
                        value={batchDraft.albumArtist}
                        onChange={(event) =>
                          setBatchDraft((draft) => ({
                            ...draft,
                            albumArtist: event.target.value,
                          }))
                        }
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
                        onChange={(event) =>
                          setBatchDraft((draft) => ({
                            ...draft,
                            discNumber: event.target.value,
                          }))
                        }
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
                          }}
                        />
                        Change release date
                      </span>
                      <input
                        aria-label="Batch release date value"
                        placeholder="YYYY, YYYY-MM, YYYY-MM-DD; empty clears"
                        disabled={!batchEnabled.year}
                        value={batchDraft.year}
                        onChange={(event) =>
                          setBatchDraft((draft) => ({
                            ...draft,
                            year: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
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
                    <div className="preview" aria-label="Batch confirmation">
                      <h4>Per-file review</h4>
                      <p>
                        No file has changed yet. Unchanged tracks will be
                        skipped; every other track is checked again before its
                        write.
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
                  <div
                    className="preview"
                    aria-label="Track number sequencing"
                    ref={sequenceEditorRef}
                    tabIndex={-1}
                  >
                    <h4>Sequence track numbers</h4>
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
                        }}
                      />
                    </label>
                    <div>
                      <label>
                        <input
                          type="checkbox"
                          checked={sequenceDiscEnabled}
                          onChange={(event) => {
                            setSequenceDiscEnabled(event.target.checked);
                            setSequencePreview(undefined);
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
                          }}
                        />
                      </label>
                    </div>
                    <button
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
                                  file.willWrite && file.warnings.length > 0,
                              )
                            }
                            onClick={() => void applyTrackNumberSequence()}
                          >
                            Confirm track-number sequence
                          </button>
                          <button onClick={() => setSequencePreview(undefined)}>
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
                  </div>
                </section>
                {selectedTrack && (
                  <section
                    className="card"
                    aria-label="Track metadata editor"
                    ref={trackEditorRef}
                    tabIndex={-1}
                  >
                    <h3>Workbench · track metadata</h3>
                    <p>
                      Editing {selectedTrack.tags.title}. Only fields that
                      differ will be included in the write.
                    </p>
                    <div className="field-grid">
                      <label>
                        Track title
                        <input
                          value={trackDraft.title}
                          onChange={(event) =>
                            setTrackDraft((draft) => ({
                              ...draft,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Track artist
                        <input
                          value={trackDraft.artist}
                          onChange={(event) =>
                            setTrackDraft((draft) => ({
                              ...draft,
                              artist: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Album artist
                        <input
                          value={trackDraft.albumArtist}
                          onChange={(event) =>
                            setTrackDraft((draft) => ({
                              ...draft,
                              albumArtist: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Track number
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          value={trackDraft.trackNumber}
                          onChange={(event) =>
                            setTrackDraft((draft) => ({
                              ...draft,
                              trackNumber: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Disc number
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={trackDraft.discNumber}
                          onChange={(event) =>
                            setTrackDraft((draft) => ({
                              ...draft,
                              discNumber: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Release date
                        <input
                          placeholder="YYYY, YYYY-MM, or YYYY-MM-DD"
                          value={trackDraft.year}
                          onChange={(event) =>
                            setTrackDraft((draft) => ({
                              ...draft,
                              year: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() => void previewTrackEdit()}
                      >
                        Preview track changes
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setSelectedTrackId(undefined);
                          setTrackEditPreview(undefined);
                        }}
                      >
                        Close editor
                      </button>
                    </div>
                    {trackEditPreview && (
                      <div
                        className="preview"
                        aria-label="Track metadata confirmation"
                      >
                        <h4>Review before writing</h4>
                        <p>
                          No file has changed yet. The proposal will be checked
                          again immediately before the safe write.
                        </p>
                        <table>
                          <thead>
                            <tr>
                              <th>Field</th>
                              <th>Before</th>
                              <th>After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trackEditPreview.changes.map((change) => (
                              <tr key={change.field}>
                                <td>{change.field}</td>
                                <td>{change.before ?? "Not set"}</td>
                                <td>{change.after ?? "Not set"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {trackEditPreview.warnings.map((warning) => (
                          <p key={warning} role="alert">
                            {warning}
                          </p>
                        ))}
                        <div className="actions">
                          <button
                            className="primary"
                            disabled={
                              busy || trackEditPreview.warnings.length > 0
                            }
                            onClick={() => void applyTrackEdit()}
                          >
                            Confirm and write track
                          </button>
                          <button
                            onClick={() => setTrackEditPreview(undefined)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
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
                    <div className="preview" aria-label="Tag edit confirmation">
                      <h4>Review before writing</h4>
                      <p>
                        No file has changed yet. Confirming creates a snapshot,
                        writes a same-volume temporary file, verifies it, and
                        only then replaces the original.
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
                  <div className="history" aria-label="Metadata edit history">
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
                                  dateTime={item.completedAt ?? item.createdAt}
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
                    <div className="preview" aria-label="Tag undo confirmation">
                      <h4>Review undo before writing</h4>
                      <p>
                        No file has changed yet. Undo only proceeds when the
                        current album title still matches the verified edit.
                        Each file is snapshotted, safely written, re-read, and
                        verified again.
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
                        <button onClick={() => setTrackUndoPreview(undefined)}>
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
                        Only fields written by the original batch are restored,
                        and only for files whose original writes were verified.
                        Conflicted files will be refused without stopping safe
                        restores on other files.
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
                                file.willWrite && file.warnings.length === 0,
                            )
                          }
                          onClick={() => void applyBatchUndo()}
                        >
                          Confirm safe batch undo writes
                        </button>
                        <button onClick={() => setBatchUndoPreview(undefined)}>
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
                            {result.verified ? "verified" : "refused or failed"}
                            {result.error ? ` — ${result.error}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
                <section className="card">
                  <h3>Sync · folder-backed DAP</h3>
                  <p>
                    Copies only. This slice never deletes target files or
                    modifies source audio.
                  </p>
                  <button disabled={busy} onClick={() => void chooseTarget()}>
                    Choose fake DAP target
                  </button>
                  {profile && (
                    <div>
                      <p>
                        <strong>{profile.name}</strong>
                        <br />
                        {profile.targetPath}
                      </p>
                      <button onClick={() => void planSync()}>
                        Preview sync plan
                      </button>
                    </div>
                  )}
                  {syncPlan && (
                    <div className="preview" aria-label="Sync confirmation">
                      <h4>Sync preview</h4>
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
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </main>
      )}
      {totalItems > PAGE_SIZE && (
        <nav className="pagination" aria-label="Library pages">
          <button
            disabled={pageOffset === 0}
            onClick={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
          >
            Previous page
          </button>
          <span>
            {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, totalItems)} of{" "}
            {totalItems}
          </span>
          <button
            disabled={pageOffset + PAGE_SIZE >= totalItems}
            onClick={() => setPageOffset(pageOffset + PAGE_SIZE)}
          >
            Next page
          </button>
        </nav>
      )}
      <section className="card settings" aria-labelledby="database-safety">
        <h2 id="database-safety">Database safety</h2>
        <p>
          Backups contain the local catalog, edit history, and DAP profiles, but
          never copy or change audio files.
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
          <div className="preview" aria-label="Database restore confirmation">
            <h3>Review database replacement</h3>
            <p>
              <strong>{restorePreview.sourceName}</strong> passed integrity and
              schema checks. Restoring replaces the current Outgroove database
              and restarts the app. Source audio and DAP files are untouched.
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
              <dt>Schema</dt>
              <dd>Version {restorePreview.schemaVersion}</dd>
            </dl>
            <p>
              Outgroove creates and verifies an automatic rollback backup before
              replacing anything.
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
    </div>
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
