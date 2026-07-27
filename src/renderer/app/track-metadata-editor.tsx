import { forwardRef, type ChangeEvent, type Ref } from "react";

import type {
  TagEditResultDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  WorkbenchConfirmation,
  WorkbenchDraftHeading,
  WorkbenchRequestError,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

export interface TrackMetadataDraft {
  title: string;
  artist: string;
  albumArtist: string;
  trackNumber: string;
  trackTotal: string;
  discNumber: string;
  discTotal: string;
  year: string;
  genre: string;
  composer: string;
  conductor: string;
}

type TrackMetadataField = keyof TrackMetadataDraft;

interface ComparisonField {
  readonly field: TrackMetadataField;
  readonly label: string;
  readonly inputType?: "number";
  readonly max?: number;
  readonly placeholder?: string;
}

const comparisonFields: readonly ComparisonField[] = [
  { field: "title", label: "Track title" },
  { field: "artist", label: "Track artist" },
  { field: "albumArtist", label: "Album artist" },
  {
    field: "trackNumber",
    label: "Track number",
    inputType: "number",
    max: 9999,
  },
  {
    field: "trackTotal",
    label: "Track total",
    inputType: "number",
    max: 9999,
    placeholder: "Empty clears the total",
  },
  { field: "discNumber", label: "Disc number", inputType: "number", max: 999 },
  {
    field: "discTotal",
    label: "Disc total",
    inputType: "number",
    max: 999,
    placeholder: "Empty clears the total",
  },
  {
    field: "year",
    label: "Release date",
    placeholder: "YYYY, YYYY-MM, or YYYY-MM-DD",
  },
  {
    field: "genre",
    label: "Genre",
    placeholder: "One genre; empty clears",
  },
  {
    field: "composer",
    label: "Composer",
    placeholder: "One composer; empty clears",
  },
  {
    field: "conductor",
    label: "Conductor",
    placeholder: "One conductor; empty clears",
  },
];

const previewFieldLabels: Record<string, string> = {
  title: "Track title",
  artist: "Track artist",
  albumArtist: "Album artist",
  trackNumber: "Track number",
  trackTotal: "Track total",
  discNumber: "Disc number",
  discTotal: "Disc total",
  year: "Release date",
  genres: "Genre",
  composers: "Composer",
  conductors: "Conductor",
};

function currentValue(
  track: CatalogAlbum["tracks"][number],
  field: TrackMetadataField,
): string {
  switch (field) {
    case "title":
      return track.tags.title;
    case "artist":
      return track.tags.artist;
    case "albumArtist":
      return track.tags.albumArtist;
    case "trackNumber":
      return track.tags.trackNumber?.toString() ?? "";
    case "trackTotal":
      return track.tags.trackTotal?.toString() ?? "";
    case "discNumber":
      return track.tags.discNumber?.toString() ?? "";
    case "discTotal":
      return track.tags.discTotal?.toString() ?? "";
    case "year":
      return track.tags.year ?? "";
    case "genre":
      return (track.tags.genres ?? []).join(" · ");
    case "composer":
      return (track.tags.composers ?? []).join(" · ");
    case "conductor":
      return (track.tags.conductors ?? []).join(" · ");
  }
}

function displayValue(
  value: string | number | readonly string[] | null,
): string {
  if (Array.isArray(value))
    return value.length === 0 ? "Not set" : value.join(" · ");
  return value === null || value === "" ? "Not set" : String(value);
}

interface TrackMetadataEditorProps {
  track: CatalogAlbum["tracks"][number];
  draft: TrackMetadataDraft;
  preview: TrackTagEditPreviewDto | undefined;
  result: TagEditResultDto | undefined;
  error: string | undefined;
  busy: boolean;
  onDraftChange: (field: keyof TrackMetadataDraft, value: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onCancelPreview: () => void;
  onClose: () => void;
  showClose?: boolean;
}

function TrackMetadataEditorComponent(
  {
    track,
    draft,
    preview,
    result,
    error,
    busy,
    onDraftChange,
    onPreview,
    onConfirm,
    onCancelPreview,
    onClose,
    showClose = true,
  }: TrackMetadataEditorProps,
  ref: Ref<HTMLElement>,
): React.JSX.Element {
  const changedFields = comparisonFields.filter(
    ({ field }) => draft[field] !== currentValue(track, field),
  );

  const change =
    (field: keyof TrackMetadataDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      onDraftChange(field, event.target.value);
    };

  return (
    <section
      className="card track-editor"
      aria-label="Track metadata editor"
      ref={ref}
      tabIndex={-1}
    >
      <WorkbenchDraftHeading
        context="Tag comparison"
        title="Edit track metadata"
        description={
          <>
            Editing <strong>{track.tags.title}</strong>
            {track.tags.artist ? ` by ${track.tags.artist}` : ""}. Current
            catalog values remain visible beside the editable proposal.
            Selecting Genre replaces the complete current genre set with one
            value; an empty proposal clears it. Tracks with multiple current
            genre values stay read-only for that field so undo remains exact.
            Composer follows the same one-value rule; tracks with multiple
            current composer values cannot replace that field. Totals are
            explicit: changing or clearing one never changes its track or disc
            number. Conductor follows the same one-value rule as Composer.
          </>
        }
      />

      <dl className="track-editor-context">
        <div>
          <dt>Format</dt>
          <dd>{track.format}</dd>
        </div>
        <div>
          <dt>Source file</dt>
          <dd>{track.path}</dd>
        </div>
      </dl>

      <div className="tag-comparison" aria-label="Track tag comparison">
        <div className="tag-comparison-header" aria-hidden="true">
          <span>Tag</span>
          <span>Current value</span>
          <span>Proposed value</span>
          <span>State</span>
        </div>
        {comparisonFields.map((item) => {
          const current = currentValue(track, item.field);
          const changed = draft[item.field] !== current;
          const currentId = `track-${item.field}-current`;
          const statusId = `track-${item.field}-status`;
          return (
            <div
              className="tag-comparison-row"
              data-changed={changed ? "true" : "false"}
              key={item.field}
            >
              <div className="tag-comparison-field">
                <span className="comparison-mobile-label">Tag</span>
                <label htmlFor={`track-${item.field}`}>{item.label}</label>
              </div>
              <div className="tag-comparison-current">
                <span className="comparison-mobile-label">Current value</span>
                <span id={currentId}>{displayValue(current)}</span>
              </div>
              <div className="tag-comparison-proposed">
                <span className="comparison-mobile-label">Proposed value</span>
                <input
                  aria-describedby={`${currentId} ${statusId}`}
                  aria-label={`${item.label} proposed value`}
                  id={`track-${item.field}`}
                  max={item.max}
                  min={item.inputType ? 1 : undefined}
                  placeholder={item.placeholder}
                  type={item.inputType}
                  value={draft[item.field]}
                  onChange={change(item.field)}
                />
              </div>
              <span
                className={`comparison-status ${changed ? "changed" : "unchanged"}`}
                id={statusId}
              >
                {changed ? "Changed" : "Unchanged"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="track-comparison-summary">
        <p aria-live="polite">
          {changedFields.length === 0
            ? "No tag changes drafted."
            : `${changedFields.length} ${changedFields.length === 1 ? "field" : "fields"} changed.`}
        </p>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || changedFields.length === 0}
            onClick={onPreview}
            type="button"
          >
            Review {changedFields.length || "exact"}{" "}
            {changedFields.length === 1 ? "change" : "changes"}
          </button>
          {showClose && (
            <button disabled={busy} onClick={onClose} type="button">
              Close editor
            </button>
          )}
        </div>
      </div>

      {error && (
        <WorkbenchRequestError
          label="Track metadata request error"
          message={error}
          recovery="Revise the draft or retry the current confirmation. No unverified change is reported as complete."
        />
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.warnings.length > 0}
          busy={busy}
          cancelLabel="Return to track draft"
          confirmLabel="Confirm and write track"
          description="Outgroove will validate this proposal again, snapshot the current tags, safely replace the file, then re-read and verify every requested field."
          label="Track metadata confirmation"
          title="Review exact track changes"
          onCancel={onCancelPreview}
          onConfirm={onConfirm}
        >
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
                {preview.changes.map((item) => (
                  <tr key={item.field}>
                    <td>{previewFieldLabels[item.field] ?? item.field}</td>
                    <td>{displayValue(item.before)}</td>
                    <td>{displayValue(item.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.warnings.map((warning) => (
            <p className="workflow-error" key={warning} role="alert">
              {warning}
            </p>
          ))}
        </WorkbenchConfirmation>
      )}

      {result && (
        <WorkbenchWriteResult
          label="Track metadata result"
          results={result.results}
          subject="Track metadata write"
        />
      )}
    </section>
  );
}

export const TrackMetadataEditor = forwardRef(TrackMetadataEditorComponent);
