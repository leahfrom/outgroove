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
    description: "Use the artist credit shown for this release track.",
  },
  {
    field: "numbering",
    label: "Track and disc numbering",
    description: "Use the track and disc numbers from the selected release.",
  },
  {
    field: "isrc",
    label: "ISRC",
    description: "Use the recording code when MusicBrainz provides one.",
    advanced: true,
  },
  {
    field: "musicBrainzIds",
    label: "MusicBrainz track IDs",
    description:
      "Save MusicBrainz references for the recording, release track, and artist.",
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
          <p className="eyebrow">Match tracks one by one</p>
          <h3>Match your tracks with {release.title}</h3>
          <p>
            Choose the matching release track for each Library track, then
            choose which details to use. Outgroove never guesses these matches.
          </p>
        </div>
        <span className="candidate-confidence possible">
          {release.tracks.length} tracks on release
        </span>
      </header>

      <p className="metadata-draft-source" role="status">
        Loaded from{" "}
        {releaseResult.source === "network"
          ? "MusicBrainz"
          : releaseResult.source === "cache"
            ? "a saved result"
            : "an older saved result because MusicBrainz was unavailable"}
        . This only loaded suggestions; your Library is unchanged.
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
            <span>Details and IDs</span>
            <small>Recording codes and MusicBrainz references</small>
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
                <span>Your track</span>
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
                <span>Release track</span>
                <select
                  aria-label={`Release track for ${track.tags.title}`}
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
                  <option value="">Not matched</option>
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
                        ? "Matched; choose details to create a draft."
                        : "Matched; the chosen details already match or are unavailable."
                      : `${Object.keys(mapped.draft.changes).length} ${Object.keys(mapped.draft.changes).length === 1 ? "change" : "changes"} available`}
                  </span>
                  {Object.keys(mapped.draft.changes).length > 0 && (
                    <details>
                      <summary>See changes</summary>
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
          {mappedDrafts.length} of {album.tracks.length} Library tracks matched;{" "}
          {enabledCount} field {enabledCount === 1 ? "group" : "groups"}{" "}
          selected; {edits.length} tracks would change.
        </p>
        <button
          className="primary"
          disabled={busy || edits.length === 0}
          onClick={() => onPreview(edits)}
          type="button"
        >
          Review track changes
        </button>
      </div>

      {error && (
        <WorkbenchRequestError
          label="MusicBrainz track mapping request error"
          message={error}
          recovery="Check the track matches and selected details, then create a new review. Nothing is treated as complete until Outgroove verifies it."
        />
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={preview.files.some(
            (file) => file.willWrite && file.warnings.length > 0,
          )}
          busy={busy}
          cancelLabel="Return to track matches"
          confirmLabel="Confirm and update tracks"
          description="Outgroove will check every file again, save its current tags for recovery, write each change safely, then reopen the file and verify both the selected details and audio."
          label="MusicBrainz track mapping confirmation"
          title="Review every track change"
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
          subject="Track update"
        />
      )}
    </section>
  );
}
