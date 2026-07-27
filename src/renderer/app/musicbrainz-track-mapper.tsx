import { useEffect, useMemo, useState } from "react";

import type {
  MusicBrainzReleaseTracklistDto,
  MusicBrainzTrackMappingPreviewRequest,
  TagEditResultDto,
  TrackBatchEditPreviewDto,
} from "../../shared/contracts/api";
import {
  createMusicBrainzMappedTrackDraft,
  formatArtistCredits,
  type MusicBrainzMappedTrackChanges,
  type MusicBrainzTrackDraftField,
  type MusicBrainzTrackDraftFields,
} from "../../shared/domain/album-identification";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import type { EditableTrackTagField } from "../../shared/domain/tag-edit";
import {
  WorkbenchConfirmation,
  WorkbenchRequestError,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

const fieldOptions: readonly {
  readonly field: MusicBrainzTrackDraftField;
  readonly label: string;
  readonly description: string;
  readonly advanced?: boolean;
}[] = [
  {
    field: "title",
    label: "Track title",
    description: "Use the title credited on this release track.",
  },
  {
    field: "artist",
    label: "Track artist",
    description: "Preserve the ordered credited names and join phrases.",
  },
  {
    field: "numbering",
    label: "Track and disc numbering",
    description:
      "Set track/disc numbers and their totals together from the selected medium.",
  },
  {
    field: "isrc",
    label: "ISRC",
    description: "Propose one unambiguous recording ISRC.",
    advanced: true,
  },
  {
    field: "musicBrainzIds",
    label: "MusicBrainz track IDs",
    description:
      "Set recording, release-track, and one unambiguous track-artist ID.",
    advanced: true,
  },
];

const previewFieldLabels: Partial<Record<EditableTrackTagField, string>> = {
  title: "Track title",
  artist: "Track artist",
  trackNumber: "Track number",
  trackTotal: "Track total",
  discNumber: "Disc number",
  discTotal: "Disc total",
  isrcs: "ISRC",
  musicBrainzRecordingId: "MusicBrainz recording ID",
  musicBrainzReleaseTrackId: "MusicBrainz release-track ID",
  musicBrainzArtistIds: "MusicBrainz track artist ID",
};

function mappedChangeEntries(
  changes: MusicBrainzMappedTrackChanges,
): readonly [EditableTrackTagField, string | number | readonly string[]][] {
  return Object.entries(changes) as [
    EditableTrackTagField,
    string | number | readonly string[],
  ][];
}

function displayValue(
  value: string | number | boolean | readonly string[] | null | undefined,
): string {
  if (Array.isArray(value))
    return value.length === 0 ? "Not set" : value.join(" · ");
  return value === null || value === undefined || value === ""
    ? "Not set"
    : String(value);
}

function duration(milliseconds: number | null): string {
  if (milliseconds === null) return "duration unknown";
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function currentValue(
  track: CatalogAlbum["tracks"][number],
  field: EditableTrackTagField,
): string | number | boolean | readonly string[] | null {
  return track.tags[field] ?? null;
}

export type MusicBrainzTrackMappingEdit =
  MusicBrainzTrackMappingPreviewRequest["edits"][number];

export function MusicBrainzTrackMapper({
  album,
  busy,
  error,
  preview,
  releaseResult,
  result,
  onCancelPreview,
  onConfirm,
  onPreview,
}: {
  readonly album: CatalogAlbum;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly preview: TrackBatchEditPreviewDto | undefined;
  readonly releaseResult: MusicBrainzReleaseTracklistDto;
  readonly result: TagEditResultDto | undefined;
  readonly onCancelPreview: () => void;
  readonly onConfirm: () => void;
  readonly onPreview: (edits: readonly MusicBrainzTrackMappingEdit[]) => void;
}): React.JSX.Element {
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<MusicBrainzTrackDraftFields>({
    title: false,
    artist: false,
    numbering: false,
    isrc: false,
    musicBrainzIds: false,
  });
  const release = releaseResult.release;

  useEffect(() => {
    setMappings({});
    setEnabled({
      title: false,
      artist: false,
      numbering: false,
      isrc: false,
      musicBrainzIds: false,
    });
  }, [release.releaseId, releaseResult.fetchedAt]);

  const invalidatePreview = (): void => {
    if (preview) onCancelPreview();
  };

  const selectedRemoteIds = useMemo(
    () => new Set(Object.values(mappings).filter(Boolean)),
    [mappings],
  );
  const mappedDrafts = album.tracks.flatMap((track) => {
    const releaseTrackId = mappings[track.id];
    if (!releaseTrackId) return [];
    const remote = release.tracks.find(
      (candidate) => candidate.releaseTrackId === releaseTrackId,
    );
    if (!remote) return [];
    const draft = createMusicBrainzMappedTrackDraft(track, remote, enabled);
    return [{ track, remote, draft }];
  });
  const edits = mappedDrafts.flatMap(({ track, remote, draft }) =>
    Object.keys(draft.changes).length > 0
      ? [
          {
            fileId: track.id,
            releaseTrackId: remote.releaseTrackId,
            changes: draft.changes,
          },
        ]
      : [],
  );
  const enabledCount = Object.values(enabled).filter(Boolean).length;

  return (
    <section
      aria-label="MusicBrainz track mapper"
      className="candidate-track-mapper"
    >
      <header>
        <div>
          <p className="eyebrow">Manual track mapping</p>
          <h3>Map Library tracks to {release.title}</h3>
          <p>
            Choose every relationship yourself, then select the fields to
            propose. Outgroove does not align by position, title, or duration
            automatically.
          </p>
        </div>
        <span className="candidate-confidence possible">
          {release.tracks.length} MusicBrainz tracks
        </span>
      </header>

      <p className="metadata-draft-source" role="status">
        Loaded from{" "}
        {releaseResult.source === "network"
          ? "MusicBrainz"
          : releaseResult.source === "cache"
            ? "the local cache"
            : "an expired local cache because MusicBrainz was unavailable"}
        . Loading changed no Library metadata.
      </p>

      <fieldset className="mapping-field-selection">
        <legend>Fields to propose</legend>
        {fieldOptions
          .filter((option) => !option.advanced)
          .map((option) => (
            <label key={option.field}>
              <input
                checked={enabled[option.field]}
                disabled={busy}
                type="checkbox"
                onChange={(event) => {
                  invalidatePreview();
                  setEnabled((current) => ({
                    ...current,
                    [option.field]: event.target.checked,
                  }));
                }}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        <details className="metadata-more-fields">
          <summary>
            <span>More fields</span>
            <small>ISRC and MusicBrainz identifiers</small>
          </summary>
          {fieldOptions
            .filter((option) => option.advanced)
            .map((option) => (
              <label key={option.field}>
                <input
                  checked={enabled[option.field]}
                  disabled={busy}
                  type="checkbox"
                  onChange={(event) => {
                    invalidatePreview();
                    setEnabled((current) => ({
                      ...current,
                      [option.field]: event.target.checked,
                    }));
                  }}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
        </details>
      </fieldset>

      <div className="mapping-list">
        {album.tracks.map((track) => {
          const mapped = mappedDrafts.find(
            (candidate) => candidate.track.id === track.id,
          );
          return (
            <article className="mapping-row" key={track.id}>
              <div className="mapping-local-track">
                <span>Library track</span>
                <strong>
                  {track.tags.discNumber ?? "?"}.{track.tags.trackNumber ?? "?"}{" "}
                  {track.tags.title}
                </strong>
                <small>
                  {track.tags.artist || "Artist not set"} ·{" "}
                  {track.durationSeconds === null
                    ? "duration unknown"
                    : duration(track.durationSeconds * 1000)}
                </small>
              </div>
              <label>
                <span>MusicBrainz track</span>
                <select
                  aria-label={`MusicBrainz track for ${track.tags.title}`}
                  disabled={busy}
                  value={mappings[track.id] ?? ""}
                  onChange={(event) => {
                    invalidatePreview();
                    setMappings((current) => ({
                      ...current,
                      [track.id]: event.target.value,
                    }));
                  }}
                >
                  <option value="">Not mapped</option>
                  {release.tracks.map((remote) => (
                    <option
                      disabled={
                        selectedRemoteIds.has(remote.releaseTrackId) &&
                        mappings[track.id] !== remote.releaseTrackId
                      }
                      key={remote.releaseTrackId}
                      value={remote.releaseTrackId}
                    >
                      Disc {remote.discNumber}, track {remote.trackNumber}:{" "}
                      {remote.title} —{" "}
                      {formatArtistCredits(remote.artistCredits) ||
                        "artist unknown"}{" "}
                      ({duration(remote.lengthMs)})
                    </option>
                  ))}
                </select>
              </label>
              {mapped && (
                <div className="mapping-proposal">
                  <span>
                    {Object.keys(mapped.draft.changes).length === 0
                      ? enabledCount === 0
                        ? "Mapped; select fields to create a proposal."
                        : "Mapped; selected fields already match or are unavailable."
                      : `${Object.keys(mapped.draft.changes).length} effective tag changes`}
                  </span>
                  {Object.keys(mapped.draft.changes).length > 0 && (
                    <details>
                      <summary>Compare proposed values</summary>
                      <dl>
                        {mappedChangeEntries(mapped.draft.changes).map(
                          ([field, after]) => (
                            <div key={field}>
                              <dt>{previewFieldLabels[field] ?? field}</dt>
                              <dd>
                                {displayValue(
                                  currentValue(mapped.track, field),
                                )}{" "}
                                → {displayValue(after)}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </details>
                  )}
                  {mapped.draft.omissions.map((omission) => (
                    <small key={omission}>{omission}</small>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="track-comparison-summary">
        <p aria-live="polite">
          {mappedDrafts.length} of {album.tracks.length} Library tracks mapped;{" "}
          {enabledCount} field {enabledCount === 1 ? "group" : "groups"}{" "}
          selected; {edits.length} tracks have effective changes.
        </p>
        <button
          className="primary"
          disabled={busy || edits.length === 0}
          onClick={() => onPreview(edits)}
          type="button"
        >
          Preview mapped tracks
        </button>
      </div>

      {error && (
        <WorkbenchRequestError
          label="MusicBrainz track mapping request error"
          message={error}
          recovery="Review the explicit mappings and field selections, then request a fresh preview. No unverified change is reported as complete."
        />
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.files.some(
            (file) => file.willWrite && file.warnings.length > 0,
          )}
          busy={busy}
          cancelLabel="Return to track mappings"
          confirmLabel="Confirm and write mapped tracks"
          description="Outgroove will validate every mapped proposal again, snapshot each current tag set, safely replace each file, then re-read and verify the targeted fields and audio payload."
          label="MusicBrainz track mapping confirmation"
          title="Review every mapped file"
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
          label="MusicBrainz track mapping result"
          results={result.results}
          subject="Mapped metadata write"
        />
      )}
    </section>
  );
}
