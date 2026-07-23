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

export interface SharedFieldDraft {
  artist: string;
  albumArtist: string;
  discNumber: string;
  year: string;
}

export type SharedFieldEnabled = Record<keyof SharedFieldDraft, boolean>;

type SharedField = keyof SharedFieldDraft;
type CatalogTrack = CatalogAlbum["tracks"][number];

interface SharedComparisonField {
  readonly field: SharedField;
  readonly label: string;
  readonly inputLabel: string;
  readonly inputType?: "number";
  readonly max?: number;
  readonly placeholder?: string;
}

const comparisonFields: readonly SharedComparisonField[] = [
  {
    field: "artist",
    label: "Track artist",
    inputLabel: "Batch track artist value",
  },
  {
    field: "albumArtist",
    label: "Album artist",
    inputLabel: "Batch album artist value",
  },
  {
    field: "discNumber",
    label: "Disc number",
    inputLabel: "Batch disc number value",
    inputType: "number",
    max: 999,
    placeholder: "Empty clears the value",
  },
  {
    field: "year",
    label: "Release date",
    inputLabel: "Batch release date value",
    placeholder: "YYYY, YYYY-MM, YYYY-MM-DD; empty clears",
  },
];

const previewFieldLabels: Record<string, string> = {
  artist: "Track artist",
  albumArtist: "Album artist",
  discNumber: "Disc number",
  year: "Release date",
};

function currentValue(track: CatalogTrack, field: SharedField): string {
  switch (field) {
    case "artist":
      return track.tags.artist;
    case "albumArtist":
      return track.tags.albumArtist;
    case "discNumber":
      return track.tags.discNumber?.toString() ?? "";
    case "year":
      return track.tags.year ?? "";
  }
}

function displayValue(value: string | number | null): string {
  return value === null || value === "" ? "Not set" : String(value);
}

function uniqueCurrentValues(
  tracks: readonly CatalogTrack[],
  field: SharedField,
): readonly string[] {
  return [...new Set(tracks.map((track) => currentValue(track, field)))];
}

function proposalState(
  enabled: boolean,
  proposal: string,
  currentValues: readonly string[],
): { readonly className: string; readonly label: string } {
  if (!enabled) return { className: "unchanged", label: "Not selected" };
  if (
    currentValues.length === 1 &&
    currentValues[0] !== undefined &&
    currentValues[0] === proposal
  )
    return { className: "unchanged", label: "No effective change" };
  return {
    className: "changed",
    label: proposal === "" ? "Will clear" : "Will propose",
  };
}

interface SharedFieldEditorProps {
  readonly tracks: readonly CatalogTrack[];
  readonly enabled: SharedFieldEnabled;
  readonly draft: SharedFieldDraft;
  readonly preview: TrackBatchEditPreviewDto | undefined;
  readonly result: TagEditResultDto | undefined;
  readonly busy: boolean;
  readonly onEnabledChange: (field: SharedField, enabled: boolean) => void;
  readonly onDraftChange: (field: SharedField, value: string) => void;
  readonly onPreview: () => void;
  readonly onConfirm: () => void;
  readonly onCancelPreview: () => void;
}

function SharedFieldEditorComponent(
  {
    tracks,
    enabled,
    draft,
    preview,
    result,
    busy,
    onEnabledChange,
    onDraftChange,
    onPreview,
    onConfirm,
    onCancelPreview,
  }: SharedFieldEditorProps,
  ref: Ref<HTMLElement>,
): React.JSX.Element {
  const enabledCount = Object.values(enabled).filter(Boolean).length;

  const changeDraft =
    (field: SharedField) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      onDraftChange(field, event.target.value);
    };

  return (
    <section
      className="card shared-field-editor"
      aria-label="Batch metadata editor"
      ref={ref}
      tabIndex={-1}
    >
      <WorkbenchDraftHeading
        context="Shared tag comparison"
        title="Edit shared metadata"
        description={
          <>
            {tracks.length} tracks selected. Select only fields you intend to
            write, then compare their current values with one shared proposal.
            Track titles and track numbers stay in the single-track editor.
          </>
        }
      />

      <div className="tag-comparison" aria-label="Shared tag comparison">
        <div className="tag-comparison-header" aria-hidden="true">
          <span>Tag</span>
          <span>Current values</span>
          <span>Proposed value</span>
          <span>State</span>
        </div>
        {comparisonFields.map((item) => {
          const values = uniqueCurrentValues(tracks, item.field);
          const mixed = values.length > 1;
          const status = proposalState(
            enabled[item.field],
            draft[item.field],
            values,
          );
          const currentId = `shared-${item.field}-current`;
          const statusId = `shared-${item.field}-status`;
          return (
            <div
              className="tag-comparison-row"
              data-changed={status.className === "changed" ? "true" : "false"}
              key={item.field}
            >
              <div className="tag-comparison-field">
                <span className="comparison-mobile-label">Tag</span>
                <label className="checkbox-label">
                  <input
                    aria-describedby={`${currentId} ${statusId}`}
                    checked={enabled[item.field]}
                    disabled={busy}
                    type="checkbox"
                    onChange={(event) =>
                      onEnabledChange(item.field, event.target.checked)
                    }
                  />
                  Change {item.label.toLocaleLowerCase("en-US")}
                </label>
              </div>
              <div className="tag-comparison-current" id={currentId}>
                <span className="comparison-mobile-label">Current values</span>
                {tracks.length === 0 ? (
                  <span>No tracks selected</span>
                ) : mixed ? (
                  <details className="mixed-values">
                    <summary>Mixed values</summary>
                    <ul>
                      {tracks.map((track) => (
                        <li key={track.id}>
                          <strong>{track.tags.title}</strong>
                          <span>
                            {displayValue(currentValue(track, item.field))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <span>{displayValue(values[0] ?? "")}</span>
                )}
              </div>
              <div className="tag-comparison-proposed">
                <span className="comparison-mobile-label">Proposed value</span>
                <input
                  aria-describedby={`${currentId} ${statusId}`}
                  aria-label={item.inputLabel}
                  disabled={busy || !enabled[item.field]}
                  max={item.max}
                  min={item.inputType ? 1 : undefined}
                  placeholder={item.placeholder}
                  type={item.inputType}
                  value={draft[item.field]}
                  onChange={changeDraft(item.field)}
                />
              </div>
              <span
                className={`comparison-status ${status.className}`}
                id={statusId}
              >
                {status.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="track-comparison-summary">
        <p aria-live="polite">
          {tracks.length < 2
            ? "Select at least two tracks to edit shared fields."
            : enabledCount === 0
              ? "No shared fields selected."
              : `${enabledCount} shared ${enabledCount === 1 ? "field" : "fields"} selected for review.`}
        </p>
        <button
          className="primary"
          disabled={busy || tracks.length < 2 || enabledCount === 0}
          onClick={onPreview}
          type="button"
        >
          Preview selected tracks
        </button>
      </div>

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.files.some(
            (file) => file.willWrite && file.warnings.length > 0,
          )}
          busy={busy}
          cancelLabel="Return to shared-field draft"
          confirmLabel="Confirm and write selected tracks"
          description="Unchanged tracks will be skipped. Every proposed write is checked again immediately before Outgroove creates a snapshot and writes."
          label="Batch confirmation"
          title="Review every selected file"
          onCancel={onCancelPreview}
          onConfirm={onConfirm}
        >
          <div className="workbench-file-reviews">
            {preview.files.map((file) => (
              <article key={file.fileId}>
                <h5>{file.path}</h5>
                {!file.willWrite && (
                  <p className="review-status">Status: unchanged — skipped</p>
                )}
                {file.changes.length > 0 && (
                  <div className="preview-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Current</th>
                          <th>Proposed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {file.changes.map((change) => (
                          <tr key={change.field}>
                            <td>
                              {previewFieldLabels[change.field] ?? change.field}
                            </td>
                            <td>{displayValue(change.before)}</td>
                            <td>{displayValue(change.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {file.warnings.map((warning) => (
                  <p className="workflow-error" key={warning} role="alert">
                    {warning}
                  </p>
                ))}
              </article>
            ))}
          </div>
        </WorkbenchConfirmation>
      )}

      {result && (
        <WorkbenchWriteResult
          label="Batch metadata result"
          results={result.results}
          subject="Shared-field write"
        />
      )}
    </section>
  );
}

export const SharedFieldEditor = forwardRef(SharedFieldEditorComponent);
