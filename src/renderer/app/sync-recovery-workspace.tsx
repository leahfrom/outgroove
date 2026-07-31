import type { Ref } from "react";

import type {
  SyncRecoveryPreviewDto,
  SyncRecoverySummaryDto,
} from "../../shared/contracts/api";

export interface SyncRecoveryFeedback {
  readonly runId: string;
  readonly profileName: string;
  readonly status: "complete" | "incomplete" | "failed";
  readonly recovered: number;
  readonly messages: readonly string[];
}

export function SyncRecoveryWorkspace({
  recoveries,
  preview,
  feedback,
  busy,
  targetVolumeConfirmed,
  previewHeadingRef,
  feedbackHeadingRef,
  onReview,
  onConfirm,
  onClosePreview,
  onDismissFeedback,
  onReturn,
  onTargetVolumeConfirmedChange,
}: {
  readonly recoveries: readonly SyncRecoverySummaryDto[];
  readonly preview: SyncRecoveryPreviewDto | undefined;
  readonly feedback: SyncRecoveryFeedback | undefined;
  readonly busy: boolean;
  readonly targetVolumeConfirmed: boolean;
  readonly previewHeadingRef: Ref<HTMLHeadingElement>;
  readonly feedbackHeadingRef: Ref<HTMLHeadingElement>;
  readonly onReview: (recovery: SyncRecoverySummaryDto) => void;
  readonly onConfirm: (recovery: SyncRecoveryPreviewDto) => void;
  readonly onClosePreview: () => void;
  readonly onDismissFeedback: () => void;
  readonly onReturn: () => void;
  readonly onTargetVolumeConfirmedChange: (confirmed: boolean) => void;
}): React.JSX.Element {
  const restoreActions =
    preview?.actions.filter((action) => action.action === "restore") ?? [];
  const removeActions =
    preview?.actions.filter((action) => action.action === "remove") ?? [];

  return (
    <section
      className="card sync-recovery-workspace"
      aria-labelledby="sync-recovery-title"
    >
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Pick up safely</p>
          <h2 id="sync-recovery-title">Finish an interrupted sync</h2>
          <p>
            Outgroove checks the destination and shows every proposed action
            before asking you to confirm. Source audio is never changed.
          </p>
        </div>
      </div>

      {feedback && (
        <section
          className={`sync-recovery-feedback is-${feedback.status}`}
          aria-label={`Recovery result for ${feedback.profileName}`}
          role={feedback.status === "complete" ? "status" : "alert"}
        >
          <div>
            <p className="eyebrow">Recovery result</p>
            <h3 ref={feedbackHeadingRef} tabIndex={-1}>
              {feedback.status === "complete"
                ? "Recovery complete"
                : feedback.status === "incomplete"
                  ? "Recovery still needs attention"
                  : "Recovery could not be applied"}
            </h3>
            <p>
              <strong>{feedback.profileName}</strong>
              {feedback.status === "failed"
                ? " was not changed."
                : `: ${feedback.recovered} ${feedback.recovered === 1 ? "reviewed change was" : "reviewed changes were"} restored or removed.`}
            </p>
          </div>
          {feedback.messages.length > 0 && (
            <ul
              aria-label={`Recovery result notes for ${feedback.profileName}`}
            >
              {feedback.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <button disabled={busy} onClick={onDismissFeedback} type="button">
            Dismiss recovery result
          </button>
        </section>
      )}

      {recoveries.length === 0 ? (
        <div className="empty compact">
          <h3>No recovery is pending</h3>
          <p>Outgroove has no interrupted target changes requiring review.</p>
          <button onClick={onReturn} type="button">
            Return to albums and profiles
          </button>
        </div>
      ) : (
        <>
          <div className="sync-recovery-pending-heading">
            <div>
              <p className="eyebrow">Pending review</p>
              <h3>
                {recoveries.length} interrupted{" "}
                {recoveries.length === 1 ? "sync" : "syncs"}
              </h3>
            </div>
            <p>
              Database restore remains blocked until every pending recovery is
              complete.
            </p>
          </div>
          <ul
            className="sync-recovery-list"
            aria-label="Interrupted sync recoveries"
          >
            {recoveries.map((recovery) => {
              const selected = preview?.runId === recovery.runId;
              return (
                <li
                  data-selected={selected ? "true" : "false"}
                  key={recovery.runId}
                >
                  <div className="sync-recovery-card-heading">
                    <div>
                      <strong>{recovery.profileName}</strong>
                      <span className="sync-target-path">
                        {recovery.targetPath}
                      </span>
                    </div>
                    <span
                      className={
                        recovery.mode === "rollback"
                          ? "sync-recovery-mode is-rollback"
                          : "sync-recovery-mode is-cleanup"
                      }
                    >
                      {recovery.mode === "rollback"
                        ? "Rollback required"
                        : "Cleanup only"}
                    </span>
                  </div>
                  <p>
                    {recovery.mode === "committed-cleanup"
                      ? "The sync finished successfully, but some temporary Outgroove files still need cleanup."
                      : `The sync stopped during ${recovery.phase}. Review how Outgroove can return the destination to its previous state.`}
                  </p>
                  <p>
                    Interrupted{" "}
                    <time dateTime={recovery.interruptedAt}>
                      {new Date(recovery.interruptedAt).toLocaleString()}
                    </time>
                  </p>
                  <button
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => onReview(recovery)}
                    type="button"
                  >
                    {selected
                      ? "Recovery review open for"
                      : "Review recovery for"}{" "}
                    {recovery.profileName}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {preview && (
        <section
          className="sync-recovery-preview"
          aria-label={`Recovery confirmation for ${preview.profileName}`}
        >
          <div className="sync-recovery-preview-heading">
            <div>
              <p className="eyebrow">
                {preview.canRecover
                  ? "Ready for confirmation"
                  : "Recovery blocked"}
              </p>
              <h3 ref={previewHeadingRef} tabIndex={-1}>
                Recovery plan for {preview.profileName}
              </h3>
              <p className="sync-target-path">{preview.targetPath}</p>
            </div>
            <span
              className={
                preview.canRecover
                  ? "sync-plan-status is-ready"
                  : "sync-plan-status is-blocked"
              }
            >
              {preview.canRecover ? "Inspected" : "Needs attention"}
            </span>
          </div>

          <dl
            className="sync-recovery-summary"
            aria-label={`Recovery action summary for ${preview.profileName}`}
          >
            <div>
              <dt>Restore</dt>
              <dd>{restoreActions.length}</dd>
            </div>
            <div>
              <dt>Remove</dt>
              <dd>{removeActions.length}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{preview.warnings.length}</dd>
            </div>
            <div>
              <dt>Storage check</dt>
              <dd>
                {preview.targetVolume.status === "matched"
                  ? "Saved storage matches"
                  : "Confirmation required"}
              </dd>
            </div>
          </dl>

          <div className="sync-recovery-action-groups">
            <RecoveryActionGroup
              actions={restoreActions}
              description="Put an available pre-sync copy back at its reviewed destination."
              title="Restore previous target files"
            />
            <RecoveryActionGroup
              actions={removeActions}
              description="Remove only reviewed temporary, rollback, or uncommitted files recorded by this interrupted Outgroove run."
              title="Remove reviewed Outgroove state"
            />
          </div>

          {preview.warnings.length > 0 && (
            <section className="sync-recovery-warnings" role="alert">
              <h4>Files left untouched or actions blocked</h4>
              <p>
                Outgroove preserves unexpected external changes and reports
                anything it cannot inspect safely.
              </p>
              <ul aria-label={`Recovery warnings for ${preview.profileName}`}>
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          )}

          {preview.targetVolume.confirmationRequired && (
            <section
              className="sync-volume-confirmation"
              aria-label="Recovery volume identity confirmation"
            >
              <div>
                <strong>
                  Outgroove cannot confirm this is the storage used by the
                  interrupted sync.
                </strong>
                <span>
                  Check the path and device yourself before allowing any
                  reviewed restore or removal.
                </span>
              </div>
              <label>
                <input
                  checked={targetVolumeConfirmed}
                  disabled={busy || !preview.canRecover}
                  onChange={(event) =>
                    onTargetVolumeConfirmedChange(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>
                  I confirm this is the intended DAP volume for recovery
                </span>
              </label>
            </section>
          )}

          {preview.actions.length === 0 && preview.warnings.length === 0 && (
            <div className="workflow-empty">
              <h4>No target-file changes are needed</h4>
              <p>
                Confirming marks this recovery complete after Outgroove checks
                the destination again.
              </p>
            </div>
          )}

          <section
            className={
              preview.canRecover
                ? "sync-recovery-confirmation"
                : "sync-recovery-confirmation is-blocked"
            }
            aria-labelledby="sync-recovery-confirm-title"
          >
            <div>
              <p className="eyebrow">Your confirmation</p>
              <h4 id="sync-recovery-confirm-title">
                {preview.canRecover
                  ? "Apply this reviewed recovery?"
                  : "Reconnect or resolve the target first"}
              </h4>
              <p>
                Only the actions listed above are authorized. Source audio and
                unexpected target contents remain untouched.
              </p>
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  !preview.canRecover ||
                  (preview.targetVolume.confirmationRequired &&
                    !targetVolumeConfirmed)
                }
                onClick={() => onConfirm(preview)}
                type="button"
              >
                Confirm recovery for {preview.profileName}
              </button>
              <button disabled={busy} onClick={onClosePreview} type="button">
                Close recovery review
              </button>
            </div>
          </section>
        </section>
      )}
    </section>
  );
}

function RecoveryActionGroup({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description: string;
  readonly actions: SyncRecoveryPreviewDto["actions"];
}): React.JSX.Element {
  return (
    <section>
      <div>
        <h4>{title}</h4>
        <span>
          {actions.length} {actions.length === 1 ? "action" : "actions"}
        </span>
      </div>
      <p>{description}</p>
      {actions.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {actions.map((action) => (
            <li key={`${action.action}:${action.path}`}>
              <strong>{action.path}</strong>
              <span>{action.explanation}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
