import type { ScanJobDto } from "../../shared/contracts/api";

export interface ActivityProgress {
  readonly job: "scan" | "tag-edit" | "sync" | "library-quality";
  readonly completed: number;
  readonly total: number;
  readonly detail: string;
}

const progressLabels: Record<ActivityProgress["job"], string> = {
  scan: "Library scan",
  "tag-edit": "Metadata write",
  sync: "DAP sync",
  "library-quality": "Library quality review",
};

export function ActivityView({
  busy,
  progress,
  scanActive,
  scanJob,
  onCancel,
  onChooseFolder,
  onReviewScanProblems,
  onRetry,
}: {
  readonly busy: boolean;
  readonly progress: ActivityProgress | undefined;
  readonly scanActive: boolean;
  readonly scanJob: ScanJobDto | undefined;
  readonly onCancel: () => void;
  readonly onChooseFolder: () => void;
  readonly onReviewScanProblems: () => void;
  readonly onRetry: (rootId: string) => void;
}): React.JSX.Element {
  const activeProgress =
    progress && progress.completed < progress.total ? progress : undefined;
  const separateProgress =
    activeProgress && (activeProgress.job !== "scan" || !scanJob)
      ? activeProgress
      : undefined;

  if (!scanJob && !separateProgress)
    return (
      <main className="empty" aria-labelledby="activity-empty-title">
        <p className="eyebrow">Activity center</p>
        <h2 id="activity-empty-title">Nothing is running yet</h2>
        <p>
          Current metadata and DAP work will appear here while it runs, and the
          latest Library scan remains available afterward. Start by choosing a
          Library folder.
        </p>
        <button
          disabled={busy || scanActive}
          onClick={onChooseFolder}
          type="button"
        >
          Choose a Library folder
        </button>
      </main>
    );

  return (
    <main className="activity-center" aria-labelledby="activity-center-title">
      <section className="card activity-introduction">
        <p className="eyebrow">Activity center</p>
        <h2 id="activity-center-title">Current and recent work</h2>
        <p>
          Follow work already running in Outgroove. Leaving this view does not
          cancel it.
        </p>
      </section>
      {separateProgress && (
        <section
          className="card activity-section"
          aria-labelledby="current-operation-title"
        >
          <p className="eyebrow">In progress</p>
          <h2 id="current-operation-title">
            {progressLabels[separateProgress.job]}
          </h2>
          <div className="activity-progress">
            <p>{separateProgress.detail || "Waiting for an update…"}</p>
            <progress
              aria-label={`${progressLabels[separateProgress.job]} progress`}
              value={separateProgress.completed}
              max={separateProgress.total}
            />
            <p aria-live="polite">
              {separateProgress.completed} of {separateProgress.total} complete
            </p>
          </div>
        </section>
      )}
      {scanJob && (
        <section
          className="card activity-section"
          aria-labelledby="library-scan-activity-title"
        >
          <p className="eyebrow">
            {scanActive ? "In progress" : "Latest Library scan"}
          </p>
          <h2 id="library-scan-activity-title">
            Library scan: {scanJob.state}
          </h2>
          <div className="scan-job" aria-label="Scan activity">
            <div>
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
            {scanJob.result && (
              <dl className="activity-results">
                <div>
                  <dt>Parsed</dt>
                  <dd>{scanJob.result.parsed}</dd>
                </div>
                <div>
                  <dt>Unchanged</dt>
                  <dd>{scanJob.result.unchanged}</dd>
                </div>
                <div>
                  <dt>Problems</dt>
                  <dd>{scanJob.result.errors}</dd>
                </div>
              </dl>
            )}
            {scanActive && (
              <button
                disabled={scanJob.state === "cancelling"}
                onClick={onCancel}
                type="button"
              >
                {scanJob.state === "cancelling" ? "Cancelling…" : "Cancel scan"}
              </button>
            )}
            {(scanJob.state === "cancelled" ||
              scanJob.state === "failed" ||
              scanJob.state === "interrupted") && (
              <button
                disabled={!scanJob.rootId}
                onClick={() => {
                  if (scanJob.rootId) onRetry(scanJob.rootId);
                }}
                type="button"
              >
                Retry scan
              </button>
            )}
            {scanJob.result && scanJob.result.errors > 0 && (
              <button onClick={onReviewScanProblems} type="button">
                Review {scanJob.result.errors} scan{" "}
                {scanJob.result.errors === 1 ? "problem" : "problems"}
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
