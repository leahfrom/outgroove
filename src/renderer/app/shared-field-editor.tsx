import {
  forwardRef,
  useEffect,
  useState,
  type ChangeEvent,
  type Ref,
} from "react";

import type {
  TagEditResultDto,
  TrackBatchEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  WorkbenchConfirmation,
  WorkbenchDraftHeading,
  WorkbenchRequestError,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

export interface SharedFieldDraft {
  artist: string;
  albumArtist: string;
  trackTotal: string;
  discNumber: string;
  discTotal: string;
  year: string;
  genre: string;
  composer: string;
  conductor: string;
  lyricist: string;
  isrc: string;
  copyright: string;
  originalReleaseDate: string;
  language: string;
  publisher: string;
  grouping: string;
  catalogNumber: string;
  publishingDate: string;
  compilation: string;
  musicBrainzReleaseId: string;
  musicBrainzReleaseArtistId: string;
  musicBrainzReleaseGroupId: string;
}

export type SharedFieldEnabled = Record<keyof SharedFieldDraft, boolean>;

type SharedField = keyof SharedFieldDraft;
type CatalogTrack = CatalogAlbum["tracks"][number];

interface SharedComparisonField {
  readonly field: SharedField;
  readonly label: string;
  readonly inputLabel: string;
  readonly inputType?: "number";
  readonly select?: "yes-no";
  readonly max?: number;
  readonly placeholder?: string;
}

const basicComparisonFields: readonly SharedComparisonField[] = [
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
  {
    field: "genre",
    label: "Genre",
    inputLabel: "Batch genre value",
    placeholder: "One genre; empty clears",
  },
];

const moreComparisonFields: readonly SharedComparisonField[] = [
  {
    field: "trackTotal",
    label: "Track total",
    inputLabel: "Batch track total value",
    inputType: "number",
    max: 9999,
    placeholder: "Empty clears the total",
  },
  {
    field: "discTotal",
    label: "Disc total",
    inputLabel: "Batch disc total value",
    inputType: "number",
    max: 999,
    placeholder: "Empty clears the total",
  },
  {
    field: "composer",
    label: "Composer",
    inputLabel: "Batch composer value",
    placeholder: "One composer; empty clears",
  },
  {
    field: "conductor",
    label: "Conductor",
    inputLabel: "Batch conductor value",
    placeholder: "One conductor; empty clears",
  },
  {
    field: "lyricist",
    label: "Lyricist",
    inputLabel: "Batch lyricist value",
    placeholder: "One lyricist; empty clears",
  },
  {
    field: "isrc",
    label: "ISRC",
    inputLabel: "Batch ISRC value",
    placeholder: "One ISRC; empty clears",
  },
  {
    field: "copyright",
    label: "Copyright",
    inputLabel: "Batch copyright value",
    placeholder: "Empty clears",
  },
  {
    field: "originalReleaseDate",
    label: "Original release date",
    inputLabel: "Batch original release date value",
    placeholder: "YYYY, YYYY-MM, YYYY-MM-DD; empty clears",
  },
  {
    field: "language",
    label: "Language",
    inputLabel: "Batch language value",
    placeholder: "Track language; empty clears",
  },
  {
    field: "publisher",
    label: "Publisher",
    inputLabel: "Batch publisher value",
    placeholder: "One publisher; empty clears",
  },
  {
    field: "grouping",
    label: "Grouping",
    inputLabel: "Batch grouping value",
    placeholder: "Empty clears",
  },
  {
    field: "catalogNumber",
    label: "Catalog number",
    inputLabel: "Batch catalog number value",
    placeholder: "One catalog number; empty clears",
  },
  {
    field: "publishingDate",
    label: "Publishing date",
    inputLabel: "Batch publishing date value",
    placeholder: "YYYY, YYYY-MM, YYYY-MM-DD; empty clears",
  },
  {
    field: "compilation",
    label: "Compilation",
    inputLabel: "Batch compilation value",
    select: "yes-no",
  },
  {
    field: "musicBrainzReleaseId",
    label: "MusicBrainz release ID",
    inputLabel: "Batch MusicBrainz release ID value",
  },
  {
    field: "musicBrainzReleaseArtistId",
    label: "MusicBrainz release artist ID",
    inputLabel: "Batch MusicBrainz release artist ID value",
  },
  {
    field: "musicBrainzReleaseGroupId",
    label: "MusicBrainz release group ID",
    inputLabel: "Batch MusicBrainz release group ID value",
  },
];

const previewFieldLabels: Record<string, string> = {
  artist: "Track artist",
  albumArtist: "Album artist",
  trackTotal: "Track total",
  discNumber: "Disc number",
  discTotal: "Disc total",
  year: "Release date",
  genres: "Genre",
  composers: "Composer",
  conductors: "Conductor",
  lyricists: "Lyricist",
  isrcs: "ISRC",
  copyright: "Copyright",
  originalReleaseDate: "Original release date",
  language: "Language",
  publishers: "Publisher",
  grouping: "Grouping",
  catalogNumbers: "Catalog number",
  publishingDate: "Publishing date",
  compilation: "Compilation",
  musicBrainzReleaseId: "MusicBrainz release ID",
  musicBrainzReleaseArtistIds: "MusicBrainz release artist ID",
  musicBrainzReleaseGroupId: "MusicBrainz release group ID",
};

function currentValue(track: CatalogTrack, field: SharedField): string {
  switch (field) {
    case "artist":
      return track.tags.artist;
    case "albumArtist":
      return track.tags.albumArtist;
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
    case "lyricist":
      return (track.tags.lyricists ?? []).join(" · ");
    case "isrc":
      return (track.tags.isrcs ?? []).join(" · ");
    case "copyright":
      return track.tags.copyright ?? "";
    case "originalReleaseDate":
      return track.tags.originalReleaseDate ?? "";
    case "language":
      return track.tags.language ?? "";
    case "publisher":
      return (track.tags.publishers ?? []).join(" · ");
    case "grouping":
      return track.tags.grouping ?? "";
    case "catalogNumber":
      return (track.tags.catalogNumbers ?? []).join(" · ");
    case "publishingDate":
      return track.tags.publishingDate ?? "";
    case "compilation":
      return track.tags.compilation === true ? "true" : "false";
    case "musicBrainzReleaseId":
      return track.tags.musicBrainzReleaseId ?? "";
    case "musicBrainzReleaseArtistId":
      return (track.tags.musicBrainzReleaseArtistIds ?? []).join(" · ");
    case "musicBrainzReleaseGroupId":
      return track.tags.musicBrainzReleaseGroupId ?? "";
  }
}

function displayValue(
  value: string | number | boolean | readonly string[] | null,
  field?: SharedField,
): string {
  if (field === "compilation" && typeof value === "string")
    return value === "true" ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length === 0 ? "Not set" : value.join(" · ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
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
  readonly error: string | undefined;
  readonly busy: boolean;
  readonly draftSource?: string;
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
    error,
    busy,
    draftSource,
    onEnabledChange,
    onDraftChange,
    onPreview,
    onConfirm,
    onCancelPreview,
  }: SharedFieldEditorProps,
  ref: Ref<HTMLElement>,
): React.JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const enabledCount = Object.values(enabled).filter(Boolean).length;
  const moreEnabledCount = moreComparisonFields.filter(
    ({ field }) => enabled[field],
  ).length;

  useEffect(() => {
    if (moreEnabledCount > 0) setMoreOpen(true);
  }, [moreEnabledCount]);

  const changeDraft =
    (field: SharedField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
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
            {tracks.length} tracks selected. Choose only the fields you want to
            change. When tracks have different current values, Outgroove shows
            them instead of choosing one for you. More fields contains
            additional credits, release details, and provider IDs.
          </>
        }
      />
      {draftSource && (
        <p className="metadata-draft-source" role="status">
          {draftSource}
        </p>
      )}

      <div className="tag-comparison" aria-label="Basic shared tag comparison">
        <ComparisonHeader />
        {basicComparisonFields.map((item) => {
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
                  Change{" "}
                  {item.label === "ISRC" || item.label.startsWith("MusicBrainz")
                    ? item.label
                    : item.label.toLocaleLowerCase("en-US")}
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
                            {displayValue(
                              currentValue(track, item.field),
                              item.field,
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <span>{displayValue(values[0] ?? "", item.field)}</span>
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
      <details
        className="metadata-more-fields"
        open={moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary>
          <span>More fields</span>
          <small>
            {moreEnabledCount > 0
              ? `${moreEnabledCount} ${moreEnabledCount === 1 ? "field" : "fields"} selected`
              : "Totals, credits, identifiers, and rights"}
          </small>
        </summary>
        <div
          className="tag-comparison"
          aria-label="Additional shared tag comparison"
        >
          <ComparisonHeader />
          {moreComparisonFields.map((item) => {
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
                    Change{" "}
                    {item.label === "ISRC" ||
                    item.label.startsWith("MusicBrainz")
                      ? item.label
                      : item.label.toLocaleLowerCase("en-US")}
                  </label>
                </div>
                <div className="tag-comparison-current" id={currentId}>
                  <span className="comparison-mobile-label">
                    Current values
                  </span>
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
                              {displayValue(
                                currentValue(track, item.field),
                                item.field,
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span>{displayValue(values[0] ?? "", item.field)}</span>
                  )}
                </div>
                <div className="tag-comparison-proposed">
                  <span className="comparison-mobile-label">
                    Proposed value
                  </span>
                  {item.select === "yes-no" ? (
                    <select
                      aria-describedby={`${currentId} ${statusId}`}
                      aria-label={item.inputLabel}
                      disabled={busy || !enabled[item.field]}
                      value={draft[item.field]}
                      onChange={changeDraft(item.field)}
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  ) : (
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
                  )}
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
      </details>

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

      {error && (
        <WorkbenchRequestError
          label="Shared metadata request error"
          message={error}
          recovery="Adjust the selected fields or try the current confirmation again. The file-by-file review stays available when it is still safe to retry."
        />
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.files.some(
            (file) => file.willWrite && file.warnings.length > 0,
          )}
          busy={busy}
          cancelLabel="Return to shared-field draft"
          confirmLabel="Confirm and write selected tracks"
          description="Unchanged tracks will be skipped. Before each write, Outgroove checks the file again and saves its current tags for recovery."
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

function ComparisonHeader(): React.JSX.Element {
  return (
    <div className="tag-comparison-header" aria-hidden="true">
      <span>Tag</span>
      <span>Current values</span>
      <span>Proposed value</span>
      <span>State</span>
    </div>
  );
}
