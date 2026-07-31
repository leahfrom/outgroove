import {
  forwardRef,
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
  type Ref,
} from "react";

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
  lyricist: string;
  isrc: string;
  copyright: string;
  originalReleaseDate: string;
  language: string;
  comment: string;
  publisher: string;
  description: string;
  grouping: string;
  catalogNumber: string;
  publishingDate: string;
  bpm: string;
  compilation: string;
  musicBrainzRecordingId: string;
  musicBrainzReleaseTrackId: string;
  musicBrainzReleaseId: string;
  musicBrainzArtistId: string;
  musicBrainzReleaseArtistId: string;
  musicBrainzReleaseGroupId: string;
  musicBrainzWorkId: string;
}

type TrackMetadataField = keyof TrackMetadataDraft;

interface ComparisonField {
  readonly field: TrackMetadataField;
  readonly label: string;
  readonly inputType?: "number";
  readonly multiline?: boolean;
  readonly select?: "yes-no";
  readonly max?: number;
  readonly placeholder?: string;
}

const basicComparisonFields: readonly ComparisonField[] = [
  { field: "title", label: "Track title" },
  { field: "artist", label: "Track artist" },
  { field: "albumArtist", label: "Album artist" },
  {
    field: "trackNumber",
    label: "Track number",
    inputType: "number",
    max: 9999,
  },
  { field: "discNumber", label: "Disc number", inputType: "number", max: 999 },
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
];

const moreComparisonGroups: readonly {
  readonly label: string;
  readonly fields: readonly ComparisonField[];
}[] = [
  {
    label: "Numbering and credits",
    fields: [
      {
        field: "trackTotal",
        label: "Track total",
        inputType: "number",
        max: 9999,
        placeholder: "Empty clears the total",
      },
      {
        field: "discTotal",
        label: "Disc total",
        inputType: "number",
        max: 999,
        placeholder: "Empty clears the total",
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
      {
        field: "lyricist",
        label: "Lyricist",
        placeholder: "One lyricist; empty clears",
      },
      {
        field: "bpm",
        label: "BPM",
        inputType: "number",
        max: 999,
        placeholder: "Empty clears",
      },
    ],
  },
  {
    label: "Release and catalog",
    fields: [
      {
        field: "isrc",
        label: "ISRC",
        placeholder: "One ISRC; empty clears",
      },
      {
        field: "publisher",
        label: "Publisher",
        placeholder: "One publisher; empty clears",
      },
      {
        field: "grouping",
        label: "Grouping",
        placeholder: "Empty clears",
      },
      {
        field: "catalogNumber",
        label: "Catalog number",
        placeholder: "One catalog number; empty clears",
      },
      {
        field: "originalReleaseDate",
        label: "Original release date",
        placeholder: "YYYY, YYYY-MM, or YYYY-MM-DD; empty clears",
      },
      {
        field: "publishingDate",
        label: "Publishing date",
        placeholder: "YYYY, YYYY-MM, or YYYY-MM-DD; empty clears",
      },
      {
        field: "compilation",
        label: "Compilation",
        select: "yes-no",
      },
    ],
  },
  {
    label: "Notes and rights",
    fields: [
      {
        field: "copyright",
        label: "Copyright",
        placeholder: "Empty clears",
      },
      {
        field: "language",
        label: "Language",
        placeholder: "Track language; empty clears",
      },
      {
        field: "description",
        label: "Description",
        multiline: true,
        placeholder: "One description; empty clears",
      },
      {
        field: "comment",
        label: "Comment",
        multiline: true,
        placeholder: "Empty clears the comment",
      },
    ],
  },
  {
    label: "MusicBrainz identifiers",
    fields: [
      { field: "musicBrainzRecordingId", label: "MusicBrainz recording ID" },
      {
        field: "musicBrainzReleaseTrackId",
        label: "MusicBrainz release track ID",
      },
      { field: "musicBrainzReleaseId", label: "MusicBrainz release ID" },
      { field: "musicBrainzArtistId", label: "MusicBrainz track artist ID" },
      {
        field: "musicBrainzReleaseArtistId",
        label: "MusicBrainz release artist ID",
      },
      {
        field: "musicBrainzReleaseGroupId",
        label: "MusicBrainz release group ID",
      },
      { field: "musicBrainzWorkId", label: "MusicBrainz work ID" },
    ],
  },
];

const moreComparisonFields = moreComparisonGroups.flatMap(
  (group) => group.fields,
);

const comparisonFields = [...basicComparisonFields, ...moreComparisonFields];

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
  lyricists: "Lyricist",
  isrcs: "ISRC",
  copyright: "Copyright",
  originalReleaseDate: "Original release date",
  language: "Language",
  comment: "Comment",
  publishers: "Publisher",
  descriptions: "Description",
  grouping: "Grouping",
  catalogNumbers: "Catalog number",
  publishingDate: "Publishing date",
  bpm: "BPM",
  compilation: "Compilation",
  musicBrainzRecordingId: "MusicBrainz recording ID",
  musicBrainzReleaseTrackId: "MusicBrainz release track ID",
  musicBrainzReleaseId: "MusicBrainz release ID",
  musicBrainzArtistIds: "MusicBrainz track artist ID",
  musicBrainzReleaseArtistIds: "MusicBrainz release artist ID",
  musicBrainzReleaseGroupId: "MusicBrainz release group ID",
  musicBrainzWorkId: "MusicBrainz work ID",
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
    case "comment":
      return track.tags.comment ?? "";
    case "publisher":
      return (track.tags.publishers ?? []).join(" · ");
    case "description":
      return (track.tags.descriptions ?? []).join(" · ");
    case "grouping":
      return track.tags.grouping ?? "";
    case "catalogNumber":
      return (track.tags.catalogNumbers ?? []).join(" · ");
    case "publishingDate":
      return track.tags.publishingDate ?? "";
    case "bpm":
      return track.tags.bpm?.toString() ?? "";
    case "compilation":
      return track.tags.compilation === true ? "true" : "false";
    case "musicBrainzRecordingId":
      return track.tags.musicBrainzRecordingId ?? "";
    case "musicBrainzReleaseTrackId":
      return track.tags.musicBrainzReleaseTrackId ?? "";
    case "musicBrainzReleaseId":
      return track.tags.musicBrainzReleaseId ?? "";
    case "musicBrainzArtistId":
      return (track.tags.musicBrainzArtistIds ?? []).join(" · ");
    case "musicBrainzReleaseArtistId":
      return (track.tags.musicBrainzReleaseArtistIds ?? []).join(" · ");
    case "musicBrainzReleaseGroupId":
      return track.tags.musicBrainzReleaseGroupId ?? "";
    case "musicBrainzWorkId":
      return track.tags.musicBrainzWorkId ?? "";
  }
}

function currentDisplayValue(
  track: CatalogAlbum["tracks"][number],
  field: TrackMetadataField,
): string | readonly string[] {
  if (field === "compilation")
    return track.tags.compilation === true ? "Yes" : "No";
  if (field !== "comment" || (track.tags.comments?.length ?? 0) === 0)
    return currentValue(track, field);
  return (track.tags.comments ?? []).map((comment) => {
    const context = [
      comment.language ? `language ${comment.language}` : undefined,
      comment.descriptor ? `descriptor ${comment.descriptor}` : undefined,
    ].filter(Boolean);
    return context.length > 0
      ? `${comment.text} (${context.join(", ")})`
      : comment.text;
  });
}

function displayValue(
  value: string | number | boolean | readonly string[] | null,
): string {
  if (Array.isArray(value))
    return value.length === 0 ? "Not set" : value.join(" · ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === null || value === "" ? "Not set" : String(value);
}

interface TrackMetadataEditorProps {
  track: CatalogAlbum["tracks"][number];
  draft: TrackMetadataDraft;
  preview: TrackTagEditPreviewDto | undefined;
  result: TagEditResultDto | undefined;
  error: string | undefined;
  busy: boolean;
  draftSource?: string;
  identification?: ReactNode;
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
    draftSource,
    identification,
    onDraftChange,
    onPreview,
    onConfirm,
    onCancelPreview,
    onClose,
    showClose = true,
  }: TrackMetadataEditorProps,
  ref: Ref<HTMLElement>,
): React.JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const changedFields = comparisonFields.filter(
    ({ field }) => draft[field] !== currentValue(track, field),
  );
  const moreChanged = moreComparisonFields.some(
    ({ field }) => draft[field] !== currentValue(track, field),
  );
  const moreChangedCount = moreComparisonFields.filter(
    ({ field }) => draft[field] !== currentValue(track, field),
  ).length;

  useEffect(() => {
    if (moreChanged) setMoreOpen(true);
  }, [moreChanged]);

  const change =
    (field: keyof TrackMetadataDraft) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ): void => {
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
            {track.tags.artist ? ` by ${track.tags.artist}` : ""}. Change the
            fields you want while keeping the current values beside them.
            Credits, catalog details, notes, and provider IDs are under More
            fields.
          </>
        }
      />
      {draftSource && (
        <p className="metadata-draft-source" role="status">
          {draftSource}
        </p>
      )}

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

      {identification}

      <div className="tag-comparison" aria-label="Basic track tag comparison">
        <ComparisonHeader currentLabel="Current value" />
        {basicComparisonFields.map((item) => {
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
                <span id={currentId}>
                  {displayValue(currentDisplayValue(track, item.field))}
                </span>
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
      <details
        className="metadata-more-fields"
        open={moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary>
          <span>More fields</span>
          <small>
            {moreChangedCount > 0
              ? `${moreChangedCount} ${moreChangedCount === 1 ? "change" : "changes"} drafted`
              : "Totals, credits, identifiers, and rights"}
          </small>
        </summary>
        <div
          className="tag-comparison"
          aria-label="Additional track tag comparison"
        >
          <ComparisonHeader currentLabel="Current value" />
          {moreComparisonGroups.map((group) => (
            <div className="metadata-field-group" key={group.label}>
              <h4>{group.label}</h4>
              {group.fields.map((item) => {
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
                      <label htmlFor={`track-${item.field}`}>
                        {item.label}
                      </label>
                    </div>
                    <div className="tag-comparison-current">
                      <span className="comparison-mobile-label">
                        Current value
                      </span>
                      <span id={currentId}>
                        {displayValue(currentDisplayValue(track, item.field))}
                      </span>
                    </div>
                    <div className="tag-comparison-proposed">
                      <span className="comparison-mobile-label">
                        Proposed value
                      </span>
                      {item.select === "yes-no" ? (
                        <select
                          aria-describedby={`${currentId} ${statusId}`}
                          aria-label={`${item.label} proposed value`}
                          id={`track-${item.field}`}
                          value={draft[item.field]}
                          onChange={change(item.field)}
                        >
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </select>
                      ) : item.multiline ? (
                        <textarea
                          aria-describedby={`${currentId} ${statusId}`}
                          aria-label={`${item.label} proposed value`}
                          id={`track-${item.field}`}
                          maxLength={4000}
                          placeholder={item.placeholder}
                          value={draft[item.field]}
                          onChange={change(item.field)}
                        />
                      ) : (
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
                      )}
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
          ))}
        </div>
      </details>

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
          recovery="Adjust the draft or try the current confirmation again. Nothing is treated as complete until Outgroove verifies it."
        />
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.warnings.length > 0}
          busy={busy}
          cancelLabel="Return to track draft"
          confirmLabel="Confirm and write track"
          description="Outgroove will check the file again, save its current tags for recovery, write the change safely, then reopen the file and verify every selected field."
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

function ComparisonHeader({
  currentLabel,
}: {
  readonly currentLabel: string;
}): React.JSX.Element {
  return (
    <div className="tag-comparison-header" aria-hidden="true">
      <span>Tag</span>
      <span>{currentLabel}</span>
      <span>Proposed value</span>
      <span>State</span>
    </div>
  );
}
