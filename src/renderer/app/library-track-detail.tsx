import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  formatBitDepth,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
} from "../../shared/domain/audio-technical";

type AlbumTrack = CatalogAlbum["tracks"][number];

export function LibraryTrackDetail({
  busy,
  mode,
  selectedForBatch,
  track,
  onEdit,
  onToggleBatch,
}: {
  readonly busy: boolean;
  readonly mode: "library" | "workbench";
  readonly selectedForBatch: boolean;
  readonly track: AlbumTrack;
  readonly onEdit: () => void;
  readonly onToggleBatch: () => void;
}): React.JSX.Element {
  return (
    <details className="track-detail">
      <summary>
        <span className="track-identity">
          <strong>
            {track.tags.discNumber ?? 1}.{track.tags.trackNumber ?? "—"}{" "}
            {track.tags.title}
          </strong>
          <small>{track.tags.artist}</small>
        </span>
        <span className="track-summary-facts">
          <span>{track.format}</span>
          <span>{formatDuration(track.durationSeconds)}</span>
          <span>{formatFileSize(track.size)}</span>
        </span>
      </summary>
      <div className="track-detail-body">
        <dl className="track-facts">
          <dt>Track artist</dt>
          <dd>{track.tags.artist}</dd>
          <dt>Album artist</dt>
          <dd>{track.tags.albumArtist}</dd>
          <dt>Release date</dt>
          <dd>{track.tags.year ?? "Not set"}</dd>
          <dt>Container/format</dt>
          <dd>{track.format}</dd>
          <dt>Codec</dt>
          <dd>{track.codec ?? "Unknown"}</dd>
          <dt>Duration</dt>
          <dd>{formatDuration(track.durationSeconds)}</dd>
          <dt>Bitrate</dt>
          <dd>{formatBitrate(track.bitrate)}</dd>
          <dt>Sample rate</dt>
          <dd>{formatSampleRate(track.sampleRate)}</dd>
          <dt>Bit depth</dt>
          <dd>{formatBitDepth(track.bitDepth)}</dd>
          <dt>Channels</dt>
          <dd>{formatChannels(track.channels)}</dd>
          <dt>File size</dt>
          <dd>{formatFileSize(track.size)}</dd>
        </dl>
        <p className="track-path">
          <strong>File</strong>
          <span>{track.path}</span>
        </p>
        <details className="advanced-metadata">
          <summary>Advanced metadata</summary>
          <div className="advanced-metadata-grid">
            <section aria-label="Normalized track tags">
              <h4>Normalized tags</h4>
              <pre>{JSON.stringify(track.tags, null, 2)}</pre>
            </section>
            <section aria-label="Native track tags">
              <h4>Native tags</h4>
              <pre>{JSON.stringify(track.nativeTags, null, 2)}</pre>
            </section>
          </div>
        </details>
        {mode === "workbench" && (
          <div className="track-actions">
            <label>
              <input
                type="checkbox"
                checked={selectedForBatch}
                onChange={onToggleBatch}
              />
              Select {track.tags.title} for batch edit
            </label>
            <button disabled={busy} onClick={onEdit} type="button">
              Edit track metadata
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
