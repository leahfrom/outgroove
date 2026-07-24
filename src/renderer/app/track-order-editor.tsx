import { forwardRef, type ChangeEvent, type Ref } from "react";

import type {
  TagEditResultDto,
  TrackBatchEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  WorkbenchConfirmation,
  WorkbenchDraftHeading,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

type CatalogTrack = CatalogAlbum["tracks"][number];

interface SequenceValidation {
  readonly startNumber: number | undefined;
  readonly discNumber: number | undefined;
  readonly error: string | undefined;
}

function validInteger(
  value: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}

function validateSequence(
  trackCount: number,
  startDraft: string,
  discEnabled: boolean,
  discDraft: string,
): SequenceValidation {
  const startNumber = validInteger(startDraft, 1, 9999);
  if (startNumber === undefined)
    return {
      startNumber: undefined,
      discNumber: undefined,
      error: "Enter a whole starting track number from 1 to 9999.",
    };
  if (startNumber + Math.max(trackCount - 1, 0) > 9999)
    return {
      startNumber,
      discNumber: undefined,
      error: "The resulting track number would exceed 9999.",
    };
  if (!discEnabled)
    return { startNumber, discNumber: undefined, error: undefined };
  const discNumber = validInteger(discDraft, 1, 999);
  if (discNumber === undefined)
    return {
      startNumber,
      discNumber: undefined,
      error: "Enter a whole disc number from 1 to 999.",
    };
  return { startNumber, discNumber, error: undefined };
}

function displayNumber(value: number | null): string {
  return value === null ? "Not set" : String(value);
}

function previewFieldLabel(field: string): string {
  if (field === "trackNumber") return "Track number";
  if (field === "discNumber") return "Disc number";
  return field;
}

interface TrackOrderEditorProps {
  readonly tracks: readonly CatalogTrack[];
  readonly startDraft: string;
  readonly discEnabled: boolean;
  readonly discDraft: string;
  readonly preview: TrackBatchEditPreviewDto | undefined;
  readonly result: TagEditResultDto | undefined;
  readonly busy: boolean;
  readonly onStartChange: (value: string) => void;
  readonly onDiscEnabledChange: (enabled: boolean) => void;
  readonly onDiscChange: (value: string) => void;
  readonly onMove: (fileId: string, offset: -1 | 1) => void;
  readonly onPreview: () => void;
  readonly onConfirm: () => void;
  readonly onCancelPreview: () => void;
}

function TrackOrderEditorComponent(
  {
    tracks,
    startDraft,
    discEnabled,
    discDraft,
    preview,
    result,
    busy,
    onStartChange,
    onDiscEnabledChange,
    onDiscChange,
    onMove,
    onPreview,
    onConfirm,
    onCancelPreview,
  }: TrackOrderEditorProps,
  ref: Ref<HTMLElement>,
): React.JSX.Element {
  const validation = validateSequence(
    tracks.length,
    startDraft,
    discEnabled,
    discDraft,
  );
  const rows = tracks.map((track, index) => {
    const proposedTrackNumber =
      validation.startNumber === undefined
        ? undefined
        : validation.startNumber + index;
    const changed =
      validation.error === undefined &&
      (track.tags.trackNumber !== proposedTrackNumber ||
        (discEnabled && track.tags.discNumber !== validation.discNumber));
    return { track, proposedTrackNumber, changed };
  });
  const changedCount = rows.filter((row) => row.changed).length;
  const canPreview =
    tracks.length >= 2 &&
    validation.error === undefined &&
    changedCount > 0 &&
    !busy;

  const change =
    (handler: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      handler(event.target.value);
    };

  return (
    <section
      className="card track-order-editor"
      aria-label="Track number sequencing"
      ref={ref}
      tabIndex={-1}
    >
      <WorkbenchDraftHeading
        context="Sequence comparison"
        title="Sequence track numbers"
        description="Outgroove uses exactly the order below. Reorder tracks explicitly, then compare their current numbers with this draft before requesting the authoritative per-file preview."
      />

      <div className="sequence-settings">
        <label>
          Starting track number
          <input
            aria-invalid={
              validation.startNumber === undefined ||
              validation.startNumber + Math.max(tracks.length - 1, 0) > 9999
            }
            disabled={busy}
            max="9999"
            min="1"
            type="number"
            value={startDraft}
            onChange={change(onStartChange)}
          />
        </label>
        <div className="disc-assignment">
          <label className="checkbox-label">
            <input
              checked={discEnabled}
              disabled={busy}
              type="checkbox"
              onChange={(event) => onDiscEnabledChange(event.target.checked)}
            />
            Set one disc number for this sequence
          </label>
          <label>
            Sequence disc number
            <input
              aria-invalid={
                discEnabled && validInteger(discDraft, 1, 999) === undefined
              }
              disabled={busy || !discEnabled}
              max="999"
              min="1"
              type="number"
              value={discDraft}
              onChange={change(onDiscChange)}
            />
          </label>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="empty sequence-empty">
          <strong>No tracks selected</strong>
          <span>Select at least two tracks above to build a sequence.</span>
        </div>
      ) : (
        <div
          className="sequence-comparison"
          aria-label="Track number comparison"
        >
          <div className="sequence-comparison-header" aria-hidden="true">
            <span>Track</span>
            <span>Current numbers</span>
            <span>Proposed numbers</span>
            <span>State</span>
            <span>Order</span>
          </div>
          <ol>
            {rows.map(({ track, proposedTrackNumber, changed }, index) => {
              const invalid = validation.error !== undefined;
              return (
                <li
                  aria-label={`Sequence comparison for ${track.tags.title}`}
                  data-changed={changed ? "true" : "false"}
                  data-invalid={invalid ? "true" : "false"}
                  key={track.id}
                >
                  <div className="sequence-track">
                    <span className="comparison-mobile-label">Track</span>
                    <strong>{track.tags.title}</strong>
                    <span>{track.path}</span>
                  </div>
                  <div className="sequence-number">
                    <span className="comparison-mobile-label">
                      Current numbers
                    </span>
                    <span>
                      Track {displayNumber(track.tags.trackNumber)} · Disc{" "}
                      {displayNumber(track.tags.discNumber)}
                    </span>
                  </div>
                  <div className="sequence-number">
                    <span className="comparison-mobile-label">
                      Proposed numbers
                    </span>
                    {proposedTrackNumber === undefined ? (
                      <span>Invalid starting number</span>
                    ) : discEnabled && validation.discNumber === undefined ? (
                      <span>
                        Track {proposedTrackNumber} · Invalid disc number
                      </span>
                    ) : (
                      <span>
                        Track {proposedTrackNumber} ·{" "}
                        {discEnabled
                          ? `Disc ${validation.discNumber}`
                          : "Disc unchanged"}
                      </span>
                    )}
                  </div>
                  <span
                    className={`comparison-status ${
                      invalid ? "invalid" : changed ? "changed" : "unchanged"
                    }`}
                  >
                    {invalid ? "Invalid" : changed ? "Changed" : "Unchanged"}
                  </span>
                  <div className="sequence-order-actions">
                    <span className="comparison-mobile-label">Order</span>
                    <button
                      aria-label={`Move ${track.tags.title} up`}
                      disabled={busy || index === 0}
                      type="button"
                      onClick={() => onMove(track.id, -1)}
                    >
                      Move up
                    </button>
                    <button
                      aria-label={`Move ${track.tags.title} down`}
                      disabled={busy || index === tracks.length - 1}
                      type="button"
                      onClick={() => onMove(track.id, 1)}
                    >
                      Move down
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="track-comparison-summary">
        <p aria-live="polite">
          {tracks.length < 2
            ? "Select at least two tracks to preview a sequence."
            : (validation.error ??
              (changedCount === 0
                ? "Every selected track already has this sequence."
                : `${changedCount} of ${tracks.length} selected ${changedCount === 1 ? "track differs" : "tracks differ"} from this draft.`))}
        </p>
        <button
          className="primary"
          disabled={!canPreview}
          type="button"
          onClick={onPreview}
        >
          Preview track-number sequence
        </button>
      </div>

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.files.some(
            (file) => file.willWrite && file.warnings.length > 0,
          )}
          busy={busy}
          cancelLabel="Return to track order"
          confirmLabel="Confirm track-number sequence"
          description="Review the explicit order and every proposed track or disc number. Each write is checked again before its snapshot and safe replacement."
          label="Track number sequence confirmation"
          title="Review the exact sequence"
          onCancel={onCancelPreview}
          onConfirm={onConfirm}
        >
          <ol className="sequence-review-list">
            {preview.files.map((file) => (
              <li key={file.fileId}>
                <strong>{file.path}</strong>
                {file.willWrite ? (
                  <ul>
                    {file.changes.map((item) => (
                      <li key={item.field}>
                        {previewFieldLabel(item.field)}:{" "}
                        {item.before ?? "Not set"} → {item.after ?? "Not set"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "unchanged — skipped"
                )}
                {file.warnings.map((warning) => (
                  <p className="workflow-error" key={warning} role="alert">
                    {warning}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </WorkbenchConfirmation>
      )}

      {result && (
        <WorkbenchWriteResult
          label="Track number sequence result"
          results={result.results}
          subject="Track-number sequence"
        />
      )}
    </section>
  );
}

export const TrackOrderEditor = forwardRef(TrackOrderEditorComponent);
