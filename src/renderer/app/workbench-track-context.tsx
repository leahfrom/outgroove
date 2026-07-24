import { useState } from "react";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { formatDuration } from "../../shared/domain/audio-technical";
import { LibraryTrackDetail } from "./library-track-detail";

type CatalogTrack = CatalogAlbum["tracks"][number];

export function WorkbenchTrackContext({
  tracks,
  selectedTrackIds,
  selectionPurpose,
  busy,
  onSelectAll,
  onClearSelection,
  onToggleTrack,
  onEditTrack,
}: {
  readonly tracks: readonly CatalogTrack[];
  readonly selectedTrackIds: readonly string[];
  readonly selectionPurpose: string;
  readonly busy: boolean;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
  readonly onToggleTrack: (fileId: string) => void;
  readonly onEditTrack: (track: CatalogTrack) => void;
}): React.JSX.Element {
  const selectedTracks = selectedTrackIds.flatMap((fileId) => {
    const track = tracks.find((candidate) => candidate.id === fileId);
    return track ? [track] : [];
  });
  const visibleSelectedTracks = selectedTracks.slice(0, 3);
  const remainingSelectedCount =
    selectedTracks.length - visibleSelectedTracks.length;
  const [chooserOpen, setChooserOpen] = useState(selectedTracks.length === 0);

  return (
    <section
      className="card workbench-track-context"
      aria-label="Selected tracks"
    >
      <div className="workbench-track-context-heading">
        <div>
          <p className="eyebrow">Track context</p>
          <h3 aria-live="polite">
            {selectedTracks.length} of {tracks.length} tracks selected
          </h3>
          <p>
            This selection is shared by Shared fields and Track order. Choosing
            or inspecting tracks never starts a preview.
          </p>
        </div>
        <div className="actions">
          <button
            disabled={busy}
            type="button"
            onClick={() => {
              onSelectAll();
              setChooserOpen(false);
            }}
          >
            Select all tracks
          </button>
          <button
            disabled={busy || selectedTracks.length === 0}
            type="button"
            onClick={() => {
              onClearSelection();
              setChooserOpen(true);
            }}
          >
            Clear selection
          </button>
        </div>
      </div>

      {selectedTracks.length === 0 ? (
        <p className="selected-track-summary">
          No tracks selected for {selectionPurpose}.
        </p>
      ) : (
        <ul
          className="selected-track-summary"
          aria-label="Selected track names"
        >
          {visibleSelectedTracks.map((track) => (
            <li key={track.id}>{track.tags.title}</li>
          ))}
          {remainingSelectedCount > 0 && (
            <li>
              +{remainingSelectedCount} more{" "}
              {remainingSelectedCount === 1 ? "track" : "tracks"}
            </li>
          )}
        </ul>
      )}

      <details
        className="workbench-track-chooser"
        open={chooserOpen}
        onToggle={(event) => setChooserOpen(event.currentTarget.open)}
      >
        <summary>
          <span>Choose or inspect tracks</span>
          <span>
            {selectedTracks.length} selected · {tracks.length} total
          </span>
        </summary>
        <ul className="compact-track-picker">
          {tracks.map((track) => {
            const selected = selectedTrackIds.includes(track.id);
            return (
              <li data-selected={selected ? "true" : "false"} key={track.id}>
                <label>
                  <input
                    aria-label={`Select ${track.tags.title} for ${selectionPurpose}`}
                    checked={selected}
                    disabled={busy}
                    type="checkbox"
                    onChange={() => onToggleTrack(track.id)}
                  />
                  <span className="compact-track-identity">
                    <strong>
                      {track.tags.discNumber ?? 1}.
                      {track.tags.trackNumber ?? "—"} {track.tags.title}
                    </strong>
                    <span>{track.tags.artist}</span>
                  </span>
                </label>
                <span className="compact-track-facts">
                  {track.format} · {formatDuration(track.durationSeconds)}
                </span>
                <button
                  aria-label={`Edit metadata for ${track.tags.title}`}
                  disabled={busy}
                  type="button"
                  onClick={() => onEditTrack(track)}
                >
                  Edit metadata
                </button>
              </li>
            );
          })}
        </ul>

        <details className="workbench-technical-tracks">
          <summary>Inspect technical details and raw metadata</summary>
          <p>
            Technical values, source paths, normalized tags, and native tags
            remain read-only here.
          </p>
          <div className="track-list">
            {tracks.map((track) => (
              <LibraryTrackDetail
                busy={busy}
                key={track.id}
                mode="library"
                selectedForBatch={selectedTrackIds.includes(track.id)}
                selectionPurpose={selectionPurpose}
                track={track}
                onEdit={() => onEditTrack(track)}
                onToggleBatch={() => onToggleTrack(track.id)}
              />
            ))}
          </div>
        </details>
      </details>
    </section>
  );
}
