import type { LibraryRootDto, ScanJobDto } from "../../shared/contracts/api";

export function LibraryOnboarding({
  busy,
  catalogLoaded,
  libraryRoots,
  rootsLoaded,
  scanActive,
  scanJob,
  selectedRootId,
  setupError,
  onChooseFolder,
  onOpenActivity,
  onStartScan,
}: {
  readonly busy: boolean;
  readonly catalogLoaded: boolean;
  readonly libraryRoots: readonly LibraryRootDto[];
  readonly rootsLoaded: boolean;
  readonly scanActive: boolean;
  readonly scanJob: ScanJobDto | undefined;
  readonly selectedRootId: string | undefined;
  readonly setupError: string | undefined;
  readonly onChooseFolder: () => void;
  readonly onOpenActivity: () => void;
  readonly onStartScan: (rootId: string) => void;
}): React.JSX.Element {
  if (!rootsLoaded || !catalogLoaded)
    return (
      <main
        className="library-onboarding"
        aria-busy="true"
        aria-labelledby="library-onboarding-loading"
      >
        <p className="eyebrow">Your local collection</p>
        <h2 id="library-onboarding-loading">Opening your Library…</h2>
        <p>Checking your local catalog and watched folders.</p>
      </main>
    );

  const selectedRoot =
    libraryRoots.find((root) => root.id === selectedRootId) ?? libraryRoots[0];

  if (!selectedRoot)
    return (
      <main
        className="library-onboarding"
        aria-labelledby="library-onboarding-title"
      >
        <div className="onboarding-introduction">
          <p className="eyebrow">Welcome to Outgroove</p>
          <h2 id="library-onboarding-title">Start with your music folder</h2>
          <p>
            Choose one folder to build a local, searchable view of your music.
            You will review the folder before the first scan starts.
          </p>
          {setupError && (
            <p className="workflow-error" role="alert">
              {setupError}
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={onChooseFolder}
            type="button"
          >
            {busy ? "Choosing folder…" : "Choose first Library folder"}
          </button>
        </div>
        <ul className="onboarding-assurances" aria-label="Library guarantees">
          <li>
            <strong>Local and offline</strong>
            <span>
              Browsing and scanning do not need an account or network
              connection.
            </span>
          </li>
          <li>
            <strong>Read-only scanning</strong>
            <span>
              A scan reads tags and technical details. It does not change,
              rename, or move audio.
            </span>
          </li>
          <li>
            <strong>You stay in control</strong>
            <span>
              Metadata writes and DAP copies remain separate reviewed workflows.
            </span>
          </li>
        </ul>
      </main>
    );

  const selectedScan =
    scanJob?.rootId === selectedRoot.id ? scanJob : undefined;
  const needsRetry =
    selectedScan?.state === "cancelled" ||
    selectedScan?.state === "failed" ||
    selectedScan?.state === "interrupted";
  const completedWithoutMusic =
    selectedScan?.state === "completed" &&
    (selectedScan.result?.parsed ?? 0) === 0;
  const refreshingCompletedScan =
    selectedScan?.state === "completed" &&
    (selectedScan.result?.parsed ?? 0) > 0;

  return (
    <main
      className="library-onboarding"
      aria-labelledby="library-onboarding-title"
    >
      <div className="onboarding-introduction">
        <p className="eyebrow">
          {scanActive
            ? "First scan in progress"
            : needsRetry
              ? "Scan needs attention"
              : completedWithoutMusic
                ? "Folder scanned"
                : refreshingCompletedScan
                  ? "Scan complete"
                  : "Folder selected"}
        </p>
        <h2 id="library-onboarding-title">
          {scanActive
            ? "Building your Library"
            : needsRetry
              ? "Your music is safe—try the scan again"
              : completedWithoutMusic
                ? "No supported music was found"
                : refreshingCompletedScan
                  ? "Finishing your Library"
                  : "Review your first scan"}
        </h2>
        <p className="onboarding-path">
          <span>Selected folder</span>
          <strong>{selectedRoot.path}</strong>
        </p>
        {setupError && (
          <p className="workflow-error" role="alert">
            {setupError}
          </p>
        )}
        {selectedScan?.error && (
          <p className="workflow-error" role="alert">
            {selectedScan.error}
          </p>
        )}
        {scanActive ? (
          <>
            <p>
              Outgroove is reading supported audio metadata in the background.
              Leaving this view does not stop the scan.
            </p>
            {selectedScan?.state === "running" && selectedScan.total === 0 ? (
              <progress aria-label="Discovering audio files" />
            ) : selectedScan && selectedScan.total > 0 ? (
              <progress
                aria-label="Reading audio metadata"
                value={selectedScan.completed}
                max={selectedScan.total}
              />
            ) : null}
          </>
        ) : needsRetry ? (
          <p>
            The previous catalog remains intact. Retrying uses the same
            incremental, read-only scan and reports individual file problems
            without stopping unrelated work.
          </p>
        ) : completedWithoutMusic ? (
          <p>
            The scan completed without adding an album. Check that this folder
            contains supported audio, choose another folder, or review Activity
            for file-level problems.
          </p>
        ) : refreshingCompletedScan ? (
          <p>
            Metadata was read successfully. Outgroove is refreshing the album
            view now.
          </p>
        ) : (
          <p>
            Starting the scan reads supported audio tags and technical details
            inside this folder. It does not modify audio, and it works fully
            offline.
          </p>
        )}
        <div className="actions">
          {!scanActive && !refreshingCompletedScan && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => onStartScan(selectedRoot.id)}
              type="button"
            >
              {needsRetry ? "Retry first scan" : "Start first scan"}
            </button>
          )}
          {(scanActive || selectedScan) && (
            <button onClick={onOpenActivity} type="button">
              View scan activity
            </button>
          )}
          {!scanActive && !refreshingCompletedScan && (
            <button disabled={busy} onClick={onChooseFolder} type="button">
              Choose another folder
            </button>
          )}
        </div>
      </div>
      <aside className="onboarding-safety-note" aria-label="Scan safety">
        <strong>What happens next</strong>
        <ol>
          <li>Find supported music in this folder.</li>
          <li>Read its tags and audio details without changing the files.</li>
          <li>Skip problem files so the rest of the scan can finish.</li>
          <li>Show the albums in your Library.</li>
        </ol>
        <p>This scan does not edit tags or start a sync.</p>
      </aside>
    </main>
  );
}
