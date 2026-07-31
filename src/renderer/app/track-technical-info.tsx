import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  formatBitDepth,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
} from "../../shared/domain/audio-technical";
import { ModalSheet } from "./modal-sheet";

type AlbumTrack = CatalogAlbum["tracks"][number];

export function TrackTechnicalInfo({
  onClose,
  track,
}: {
  readonly onClose: () => void;
  readonly track: AlbumTrack;
}): React.JSX.Element {
  return (
    <ModalSheet
      ariaLabel={`More information about ${track.tags.title}`}
      className="technical-info-sheet"
      closeLabel="Close information"
      toolbarLabel="Track information"
      onClose={onClose}
    >
      <header className="technical-info-heading">
        <p className="eyebrow">Read-only track information</p>
        <h2>{track.tags.title}</h2>
        <p className="technical-info-artist">{track.tags.artist}</p>
        <p className="technical-info-album">From {track.tags.album}</p>
      </header>

      <section aria-labelledby="technical-properties-title">
        <h3 id="technical-properties-title">Technical properties</h3>
        <dl className="track-facts">
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
      </section>

      <section aria-labelledby="outgroove-tags-title">
        <h3 id="outgroove-tags-title">How Outgroove reads the tags</h3>
        <p>
          Outgroove combines equivalent tag formats into this consistent view.
          This read-only information can help explain what appears in your
          Library.
        </p>
        <pre>{JSON.stringify(track.tags, null, 2)}</pre>
      </section>

      <details className="advanced-metadata">
        <summary>Original file tag details</summary>
        <section aria-label="Original file tags">
          <p>
            These are the tag names and values found in the audio file. This
            information dialog cannot modify them.
          </p>
          <pre>{JSON.stringify(track.nativeTags, null, 2)}</pre>
        </section>
      </details>
    </ModalSheet>
  );
}
