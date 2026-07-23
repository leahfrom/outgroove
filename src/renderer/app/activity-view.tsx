import type { ScanJobDto } from "../../shared/contracts/api";

export function ActivityView({
  busy,
  scanActive,
  scanJob,
  onCancel,
  onChooseFolder,
  onRetry,
}: {
  readonly busy: boolean;
  readonly scanActive: boolean;
  readonly scanJob: ScanJobDto | undefined;
  readonly onCancel: () => void;
  readonly onChooseFolder: () => void;
  readonly onRetry: (rootId: string) => void;
}): React.JSX.Element {
  if (!scanJob)
    return (
      <main className="empty" aria-labelledby="activity-empty-title">
        <p className="eyebrow">Activity center</p>
        <h2 id="activity-empty-title">No Library activity yet</h2>
        <p>
          Scans, metadata writes, and DAP sync progress will appear here. Start
          by choosing a Library folder.
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
    <main className="scan-job" aria-label="Scan activity">
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
    </main>
  );
}
