import { useEffect, useMemo, useState } from "react";

import type {
  ScanErrorDto,
  SyncPlanDto,
  TagEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";

interface Progress {
  job: "scan" | "tag-edit" | "sync";
  completed: number;
  total: number;
  detail: string;
}

export function App(): React.JSX.Element {
  const [rootId, setRootId] = useState<string>();
  const [albums, setAlbums] = useState<readonly CatalogAlbum[]>([]);
  const [scanErrors, setScanErrors] = useState<readonly ScanErrorDto[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>();
  const [editTitle, setEditTitle] = useState("");
  const [editPreview, setEditPreview] = useState<TagEditPreviewDto>();
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    targetPath: string;
  }>();
  const [syncPlan, setSyncPlan] = useState<SyncPlanDto>();
  const [progress, setProgress] = useState<Progress>();
  const [notice, setNotice] = useState(
    "Choose a fixture or test library folder to begin.",
  );
  const [busy, setBusy] = useState(false);
  const selectedAlbum = useMemo(
    () => albums.find((album) => album.id === selectedAlbumId),
    [albums, selectedAlbumId],
  );

  const refreshCatalog = async (): Promise<void> => {
    const [albumResult, errorResult] = await Promise.all([
      window.outgroove.listAlbums(),
      window.outgroove.listScanErrors(),
    ]);
    if (albumResult.ok) {
      setAlbums(albumResult.value);
      setSelectedAlbumId((current) =>
        current && albumResult.value.some((album) => album.id === current)
          ? current
          : albumResult.value[0]?.id,
      );
    } else setNotice(albumResult.error.message);
    if (errorResult.ok) setScanErrors(errorResult.value);
  };

  useEffect(() => window.outgroove.onJobProgress(setProgress), []);
  useEffect(() => {
    void refreshCatalog();
  }, []);

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
      const scanned = await window.outgroove.scanLibrary({
        rootId: selected.value.id,
      });
      if (!scanned.ok) {
        setNotice(scanned.error.message);
        return;
      }
      setNotice(
        `Scan finished: ${scanned.value.parsed} parsed, ${scanned.value.unchanged} unchanged, ${scanned.value.errors} errors.`,
      );
      await refreshCatalog();
    } finally {
      setBusy(false);
    }
  };

  const rescan = async (): Promise<void> => {
    if (!rootId) return;
    setBusy(true);
    try {
      const scanned = await window.outgroove.scanLibrary({ rootId });
      setNotice(
        scanned.ok
          ? `Repeat scan: ${scanned.value.parsed} parsed, ${scanned.value.unchanged} unchanged, ${scanned.value.errors} errors.`
          : scanned.error.message,
      );
      await refreshCatalog();
    } finally {
      setBusy(false);
    }
  };

  const previewEdit = async (): Promise<void> => {
    if (!selectedAlbum) return;
    const result = await window.outgroove.previewAlbumTitleEdit({
      albumId: selectedAlbum.id,
      proposedTitle: editTitle,
    });
    if (result.ok) setEditPreview(result.value);
    else setNotice(result.error.message);
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
          <button disabled={busy} onClick={() => void chooseAndScan()}>
            Choose library folder
          </button>
          <button disabled={busy || !rootId} onClick={() => void rescan()}>
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
      {albums.length === 0 ? (
        <main className="empty">
          <h2>Your Library is empty</h2>
          <p>
            Select a folder containing disposable fixtures or files you
            explicitly intend Outgroove to scan. Scanning and browsing stay
            offline.
          </p>
          <button disabled={busy} onClick={() => void chooseAndScan()}>
            Choose a library folder
          </button>
        </main>
      ) : (
        <main className="workspace">
          <aside aria-label="Albums">
            <h2>Albums</h2>
            {albums.map((album) => (
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
              </button>
            ))}
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
                    </details>
                  ))}
                </div>
                <section className="card">
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
      {scanErrors.length > 0 && (
        <section className="errors" aria-labelledby="scan-errors">
          <h2 id="scan-errors">Scan errors ({scanErrors.length})</h2>
          <ul>
            {scanErrors.map((error) => (
              <li key={error.path}>
                <strong>{error.path}</strong>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
