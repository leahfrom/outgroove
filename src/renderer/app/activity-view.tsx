import type { ScanJobDto, ScanJobState } from "../../shared/contracts/api";

export interface ActivityProgress {
  readonly job: "scan" | "tag-edit" | "sync" | "library-quality" | "radar";
  readonly completed: number;
  readonly total: number;
  readonly detail: string;
}

const progressLabels: Record<ActivityProgress["job"], string> = {
  scan: "Library scan",
  "tag-edit": "Metadata write",
  sync: "DAP sync",
  "library-quality": "Library quality review",
  radar: "Radar refresh",
};

const scanStateLabels: Record<ScanJobState, string> = {
  queued: "Preparing",
  running: "Scanning",
  cancelling: "Cancelling safely",
  completed: "Complete",
  cancelled: "Cancelled safely",
  failed: "Failed",
  interrupted: "Interrupted",
};

function needsScanAttention(scanJob: ScanJobDto | undefined): boolean {
  if (!scanJob) return false;
  return (
    scanJob.state === "failed" ||
    scanJob.state === "interrupted" ||
    (scanJob.result?.errors ?? 0) > 0
  );
}

export function ActivityView({
  busy,
  progress,
  scanActive,
  scanJob,
  onCancel,
  onChooseFolder,
  onOpenLibrary,
  onOpenSync,
  onReviewScanProblems,
  onRetry,
}: {
  readonly busy: boolean;
  readonly progress: ActivityProgress | undefined;
  readonly scanActive: boolean;
  readonly scanJob: ScanJobDto | undefined;
  readonly onCancel: () => void;
  readonly onChooseFolder: () => void;
  readonly onOpenLibrary: () => void;
  readonly onOpenSync: () => void;
  readonly onReviewScanProblems: () => void;
  readonly onRetry: (rootId: string) => void;
}): React.JSX.Element {
  const activeProgress =
    progress && progress.completed < progress.total ? progress : undefined;
  const separateProgress =
    activeProgress && (activeProgress.job !== "scan" || !scanJob)
      ? activeProgress
      : undefined;
  const attentionRequired = needsScanAttention(scanJob);
  const activeWorkCount =
    Number(scanActive) + Number(Boolean(separateProgress));

  return (
    <main className="activity-center" aria-labelledby="activity-center-title">
      <section className="activity-introduction">
        <div>
          <p className="eyebrow">What’s happening</p>
          <h2 id="activity-center-title">Outgroove activity</h2>
          <p>
            See what is running and what may need your attention. You can leave
            this page without stopping the work.
          </p>
        </div>
        <dl className="activity-overview" aria-label="Activity overview">
          <div>
            <dt>Active</dt>
            <dd>{activeWorkCount}</dd>
          </div>
          <div className={attentionRequired ? "activity-status-attention" : ""}>
            <dt>Needs attention</dt>
            <dd>{attentionRequired ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Latest scan</dt>
            <dd>{scanJob ? scanStateLabels[scanJob.state] : "Not run"}</dd>
          </div>
        </dl>
      </section>

      {activeWorkCount > 0 ? (
        <section
          className="activity-workspace"
          aria-labelledby="active-work-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Active work</p>
              <h2 id="active-work-title">
                {activeWorkCount === 1
                  ? "One operation is running"
                  : `${activeWorkCount} operations are running`}
              </h2>
            </div>
            <p aria-live="polite">
              It is safe to navigate elsewhere while this work continues.
            </p>
          </div>

          <div className="activity-operation-list">
            {separateProgress && (
              <article
                className="activity-operation"
                aria-labelledby="current-operation-title"
              >
                <div className="activity-operation-heading">
                  <div>
                    <p className="activity-state">In progress</p>
                    <h3 id="current-operation-title">
                      {progressLabels[separateProgress.job]}
                    </h3>
                  </div>
                  <strong>
                    {separateProgress.completed} of {separateProgress.total}
                  </strong>
                </div>
                <div className="activity-progress">
                  <p>{separateProgress.detail || "Waiting for an update…"}</p>
                  <progress
                    aria-label={`${progressLabels[separateProgress.job]} progress`}
                    value={separateProgress.completed}
                    max={separateProgress.total}
                  />
                </div>
              </article>
            )}

            {scanActive && scanJob && (
              <ScanActivity
                scanJob={scanJob}
                onCancel={onCancel}
                onOpenLibrary={onOpenLibrary}
                onReviewScanProblems={onReviewScanProblems}
                onRetry={onRetry}
              />
            )}
          </div>
        </section>
      ) : !scanJob ? (
        <section
          className="activity-quiet-state"
          aria-labelledby="quiet-activity-title"
        >
          <div>
            <p className="eyebrow">All quiet</p>
            <h2 id="quiet-activity-title">No work is running</h2>
            <p>
              Browse your Library or prepare a sync. New progress will appear
              here automatically.
            </p>
          </div>
          <div className="actions">
            <button onClick={onOpenLibrary} type="button">
              Browse Library
            </button>
            <button className="secondary" onClick={onOpenSync} type="button">
              Open Sync
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={onChooseFolder}
              type="button"
            >
              Choose Library folder
            </button>
          </div>
        </section>
      ) : null}

      {scanJob && !scanActive && (
        <section
          className={`activity-workspace activity-scan-result ${
            attentionRequired ? "needs-attention" : ""
          }`}
          aria-labelledby="latest-scan-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {attentionRequired ? "Needs attention" : "Latest Library scan"}
              </p>
              <h2 id="latest-scan-title">{scanStateLabels[scanJob.state]}</h2>
            </div>
            <p>
              {attentionRequired
                ? "Your existing catalog remains available while you review the result."
                : "Your Library is ready to browse."}
            </p>
          </div>
          <ScanActivity
            scanJob={scanJob}
            showHeading={false}
            onCancel={onCancel}
            onOpenLibrary={onOpenLibrary}
            onReviewScanProblems={onReviewScanProblems}
            onRetry={onRetry}
          />
        </section>
      )}
    </main>
  );
}

function ScanActivity({
  scanJob,
  onCancel,
  onOpenLibrary,
  onReviewScanProblems,
  onRetry,
  showHeading = true,
}: {
  readonly scanJob: ScanJobDto;
  readonly onCancel: () => void;
  readonly onOpenLibrary: () => void;
  readonly onReviewScanProblems: () => void;
  readonly onRetry: (rootId: string) => void;
  readonly showHeading?: boolean;
}): React.JSX.Element {
  const scanActive =
    scanJob.state === "queued" ||
    scanJob.state === "running" ||
    scanJob.state === "cancelling";
  const retryable =
    scanJob.state === "cancelled" ||
    scanJob.state === "failed" ||
    scanJob.state === "interrupted";
  const showDetail =
    Boolean(scanJob.error) ||
    (Boolean(scanJob.detail) &&
      !(scanJob.state === "completed" && scanJob.detail === "Scan complete"));

  return (
    <article className="activity-operation" aria-label="Library scan activity">
      {showHeading && (
        <div className="activity-operation-heading">
          <div>
            <p className="activity-state">{scanStateLabels[scanJob.state]}</p>
            <h3>Library scan</h3>
          </div>
          {scanJob.total > 0 && scanActive && (
            <strong>
              {scanJob.completed} of {scanJob.total}
            </strong>
          )}
        </div>
      )}

      {(showDetail || scanActive) && (
        <div className="activity-progress">
          {showDetail && <p>{scanJob.detail || "Waiting to start…"}</p>}
          {scanJob.error && <p role="alert">{scanJob.error}</p>}
          {scanJob.state === "running" && scanJob.total === 0 ? (
            <progress aria-label="Discovering audio files" />
          ) : scanJob.total > 0 && scanActive ? (
            <progress
              aria-label="Reading audio metadata"
              value={scanJob.completed}
              max={scanJob.total}
            />
          ) : null}
        </div>
      )}

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
          <div
            className={
              scanJob.result.errors > 0 ? "activity-status-attention" : ""
            }
          >
            <dt>Problems</dt>
            <dd>{scanJob.result.errors}</dd>
          </div>
        </dl>
      )}

      <div className="actions">
        {scanActive && (
          <button
            className="secondary"
            disabled={scanJob.state === "cancelling"}
            onClick={onCancel}
            type="button"
          >
            {scanJob.state === "cancelling" ? "Cancelling…" : "Cancel scan"}
          </button>
        )}
        {retryable && (
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
        {scanJob.state === "completed" && (
          <button
            className={
              scanJob.result && scanJob.result.errors > 0 ? "secondary" : ""
            }
            onClick={onOpenLibrary}
            type="button"
          >
            Browse Library
          </button>
        )}
      </div>
    </article>
  );
}
