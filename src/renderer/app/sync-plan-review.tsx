import type { Ref } from "react";

import type {
  SyncHistoryItemDto,
  SyncPlanDto,
} from "../../shared/contracts/api";
import { formatFileSize } from "../../shared/domain/audio-technical";

interface ActiveSyncProfile {
  readonly id: string;
  readonly name: string;
  readonly targetPath: string;
  readonly albumIds: readonly string[];
}

export function SyncPlanReview({
  profile,
  plan,
  history,
  historyProfileId,
  historyLoading,
  busy,
  editingProfile,
  applyingPlanId,
  cancellationRequested,
  cleanupEnabled,
  targetVolumeConfirmed,
  planHeadingRef,
  onPreview,
  onManage,
  onApply,
  onCancel,
  onCleanupEnabledChange,
  onTargetVolumeConfirmedChange,
}: {
  readonly profile: ActiveSyncProfile;
  readonly plan: SyncPlanDto | undefined;
  readonly history: readonly SyncHistoryItemDto[];
  readonly historyProfileId: string | undefined;
  readonly historyLoading: boolean;
  readonly busy: boolean;
  readonly editingProfile: boolean;
  readonly applyingPlanId: string | undefined;
  readonly cancellationRequested: boolean;
  readonly cleanupEnabled: boolean;
  readonly targetVolumeConfirmed: boolean;
  readonly planHeadingRef: Ref<HTMLHeadingElement>;
  readonly onPreview: () => void;
  readonly onManage: () => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly onCleanupEnabledChange: (enabled: boolean) => void;
  readonly onTargetVolumeConfirmedChange: (confirmed: boolean) => void;
}): React.JSX.Element {
  const issueCount = plan ? plan.conflicts.length + plan.errors.length : 0;
  const planBlocked = issueCount > 0;
  const noChanges = plan ? !plan.hasChanges : false;
  const applying = plan ? applyingPlanId === plan.id : false;

  return (
    <section
      className="card sync-review-workspace"
      aria-labelledby="sync-review-title"
    >
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Before anything is copied</p>
          <h2 id="sync-review-title">Preview your sync</h2>
          <p>
            Check every copy, replacement, and removal before anything on your
            player changes.
          </p>
        </div>
      </div>

      <section className="sync-profile-context" aria-label="Active DAP profile">
        <div>
          <p className="eyebrow">Active profile</p>
          <h3>{profile.name}</h3>
          <p className="sync-target-path">{profile.targetPath}</p>
        </div>
        <p className="sync-profile-count">
          <strong>{profile.albumIds.length}</strong>
          <span>
            saved {profile.albumIds.length === 1 ? "album" : "albums"}
          </span>
        </p>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || editingProfile}
            onClick={onPreview}
            type="button"
          >
            {plan ? "Refresh sync plan" : "Preview sync plan"}
          </button>
          <button disabled={busy} onClick={onManage} type="button">
            Manage {profile.name}
          </button>
        </div>
        <label className="sync-cleanup-option">
          <input
            checked={cleanupEnabled}
            disabled={busy || editingProfile}
            onChange={(event) =>
              onCleanupEnabledChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>Remove obsolete files from earlier Outgroove syncs</strong>
            <small>
              Off by default. Outgroove can remove only files recorded by this
              profile’s latest completed sync, and it will show every file
              before you confirm.
            </small>
          </span>
        </label>
        {editingProfile && (
          <p className="sync-unsaved-status" role="status">
            Album-selection changes are not saved yet. Save or discard them
            before previewing.
          </p>
        )}
      </section>

      {!plan ? (
        <div className="workflow-empty" aria-label="No sync plan">
          <h3>No preview yet</h3>
          <p>
            Previewing checks your selected music and destination. It does not
            copy, replace, or remove anything. Cleanup is{" "}
            {cleanupEnabled ? "enabled for the next preview" : "disabled"}.
          </p>
        </div>
      ) : (
        <section className="sync-plan-workspace" aria-label="Sync confirmation">
          <div className="sync-plan-heading">
            <div>
              <p className="eyebrow">
                {planBlocked
                  ? "Plan needs attention"
                  : noChanges
                    ? "Player folder is up to date"
                    : "Ready for confirmation"}
              </p>
              <h3 ref={planHeadingRef} tabIndex={-1}>
                Current sync plan
              </h3>
              <p>
                This is a preview only. Review the summary and exact target
                paths before confirming.
              </p>
            </div>
            <span
              className={
                planBlocked
                  ? "sync-plan-status is-blocked"
                  : "sync-plan-status is-ready"
              }
            >
              {planBlocked
                ? `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`
                : noChanges
                  ? "No changes"
                  : "Validated"}
            </span>
          </div>

          <dl className="sync-plan-summary" aria-label="Sync plan summary">
            <div>
              <dt>Copies</dt>
              <dd>{plan.copies.length}</dd>
            </div>
            <div>
              <dt>Replacements</dt>
              <dd>{plan.replacements.length}</dd>
            </div>
            <div>
              <dt>Skipped (unchanged)</dt>
              <dd>{plan.unchanged.length}</dd>
            </div>
            <div>
              <dt>Removals</dt>
              <dd>{plan.removals.length}</dd>
            </div>
            <div>
              <dt>Issues</dt>
              <dd>{issueCount}</dd>
            </div>
            <div>
              <dt>Required space</dt>
              <dd title={`${plan.requiredBytes} bytes`}>
                {formatFileSize(plan.requiredBytes)}
              </dd>
            </div>
            <div>
              <dt>Storage check</dt>
              <dd>
                {plan.targetVolume.status === "matched"
                  ? "Saved storage matches"
                  : "Confirmation required"}
              </dd>
            </div>
          </dl>

          {planBlocked && (
            <div className="sync-plan-blocker" role="alert">
              <strong>This plan cannot be applied yet.</strong>
              <span>
                Review every conflict and error below, then generate a fresh
                plan after resolving them.
              </span>
            </div>
          )}
          {plan.targetVolume.confirmationRequired && (
            <section
              className="sync-volume-confirmation"
              aria-label="Player storage confirmation"
            >
              <div>
                <strong>
                  Outgroove cannot confirm this is the storage saved with this
                  profile.
                </strong>
                <span>
                  {plan.targetVolume.status === "changed"
                    ? "This storage does not match the details saved for this profile."
                    : plan.targetVolume.status === "unrecorded"
                      ? "This profile does not have saved details for this storage."
                      : "Outgroove could not reliably recognize this storage."}
                </span>
                <span>
                  Check the destination and player yourself. Recognizing files
                  from an earlier sync does not prove this is the same physical
                  storage.
                </span>
              </div>
              <label>
                <input
                  checked={targetVolumeConfirmed}
                  disabled={busy || planBlocked || noChanges}
                  onChange={(event) =>
                    onTargetVolumeConfirmedChange(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>
                  I confirm this is the intended player storage for this sync
                </span>
              </label>
            </section>
          )}
          {noChanges && !planBlocked && (
            <div className="sync-plan-noop" role="status">
              <strong>No player-folder changes are needed.</strong>
              <span>
                This plan cannot enter confirmation or apply. Source audio and
                the player folder remain untouched.
              </span>
            </div>
          )}

          <div className="sync-plan-details" aria-label="Exact sync plan">
            <PlanDisclosure
              items={plan.copies.map((item) => item.relativeDestination)}
              label="Files to copy"
            />
            <PlanDisclosure
              items={plan.replacements.map((item) => item.relativeDestination)}
              label="Previously synced files to replace"
            />
            <PlanDisclosure
              items={plan.unchanged.map((item) => item.relativeDestination)}
              label="Skipped unchanged files"
            />
            <PlanDisclosure
              emphasize
              items={plan.removals.map((item) => item.relativeDestination)}
              label="Previously synced files to remove"
            />
            <PlanDisclosure
              items={plan.absentOwned}
              label="Previously synced files already missing"
            />
            <PlanDisclosure
              emphasize
              items={plan.conflicts}
              label="Conflicts"
            />
            <PlanDisclosure emphasize items={plan.errors} label="Errors" />
          </div>

          {!noChanges && (
            <section
              className={
                planBlocked
                  ? "sync-apply-confirmation is-blocked"
                  : "sync-apply-confirmation"
              }
              aria-labelledby="sync-apply-title"
            >
              <div>
                <p className="eyebrow">Your confirmation</p>
                <h4 id="sync-apply-title">
                  {planBlocked
                    ? "Resolve plan issues first"
                    : "Apply this plan?"}
                </h4>
                <p>
                  Source audio stays untouched. Outgroove makes the reviewed
                  changes safely, checks the result, and saves its new
                  synced-file record only after everything succeeds.
                </p>
                {plan.removals.length > 0 && (
                  <p>
                    This confirmation includes all {plan.removals.length} exact{" "}
                    {plan.removals.length === 1 ? "removal" : "removals"} listed
                    above. Unknown target files are never removed.
                  </p>
                )}
              </div>
              <button
                className="primary"
                disabled={
                  busy ||
                  planBlocked ||
                  (plan.targetVolume.confirmationRequired &&
                    !targetVolumeConfirmed)
                }
                onClick={onApply}
                type="button"
              >
                {plan.removals.length > 0
                  ? `Confirm and apply plan with ${plan.removals.length} ${plan.removals.length === 1 ? "removal" : "removals"}`
                  : "Confirm and apply sync plan"}
              </button>
              {applying && (
                <div className="sync-apply-progress" aria-live="polite">
                  <p>
                    Status:{" "}
                    {cancellationRequested
                      ? "Cancelling safely"
                      : "Sync in progress"}
                  </p>
                  <button
                    disabled={cancellationRequested}
                    onClick={onCancel}
                    type="button"
                  >
                    Cancel active sync
                  </button>
                </div>
              )}
            </section>
          )}
        </section>
      )}

      <details className="sync-history-disclosure">
        <summary>
          <span>Completed syncs</span>
          <span>Up to 20 recent runs</span>
        </summary>
        <p>
          Only syncs whose final record of synced files was saved successfully
          appear here.
        </p>
        {historyProfileId !== profile.id || historyLoading ? (
          <p aria-live="polite">Loading completed syncs…</p>
        ) : history.length === 0 ? (
          <p>No completed syncs are recorded yet.</p>
        ) : (
          <ul aria-label={`Completed sync history for ${profile.name}`}>
            {history.map((item) => (
              <li key={item.id}>
                <time dateTime={item.completedAt}>
                  {new Date(item.completedAt).toLocaleString()}
                </time>
                <span>
                  {item.entryCount} {item.entryCount === 1 ? "file" : "files"}
                </span>
                <span>{item.targetPath}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function PlanDisclosure({
  label,
  items,
  emphasize = false,
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly emphasize?: boolean;
}): React.JSX.Element {
  return (
    <details
      className={emphasize && items.length > 0 ? "has-issues" : undefined}
      open={emphasize && items.length > 0 ? true : undefined}
    >
      <summary>
        <span>{label}</span>
        <span>
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </summary>
      {items.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
