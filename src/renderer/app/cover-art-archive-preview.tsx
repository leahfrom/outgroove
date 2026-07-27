import type { CoverArtArchiveResultDto } from "../../shared/contracts/api";
import type { ComparedAlbumCandidate } from "../../shared/domain/album-identification";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
}

function sourceLabel(source: CoverArtArchiveResultDto["source"]): string {
  return source === "network"
    ? "Cover Art Archive"
    : source === "cache"
      ? "the local metadata and in-memory thumbnail cache"
      : "an expired local metadata cache";
}

export function CoverArtArchivePreview({
  candidate,
  error,
  loading,
  result,
  onCancel,
  onLoad,
}: {
  readonly candidate: ComparedAlbumCandidate;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly result: CoverArtArchiveResultDto | undefined;
  readonly onCancel: () => void;
  readonly onLoad: () => void;
}): React.JSX.Element {
  return (
    <section
      aria-label={`Cover Art Archive preview for ${candidate.title}`}
      className="candidate-artwork"
    >
      <h4>Cover Art Archive</h4>
      <p>
        Loading this edition’s front cover sends only MusicBrainz release ID{" "}
        <span className="identifier">{candidate.releaseId}</span> to the Cover
        Art Archive. It never sends audio, current artwork, tags, or file paths.
      </p>
      <p>
        The result is read-only evidence for this exact release. It cannot
        preview or start an artwork write.
      </p>
      <div className="workflow-actions">
        <button
          aria-label={`Load Cover Art Archive front cover for ${candidate.title}, ${candidate.date ?? "unknown date"}`}
          disabled={loading}
          onClick={onLoad}
          type="button"
        >
          {result ? "Reload release front cover" : "Load release front cover"}
        </button>
        {loading && (
          <button onClick={onCancel} type="button">
            Cancel cover request
          </button>
        )}
      </div>

      <div aria-live="polite">
        {loading && "Loading the release front cover…"}
        {!loading && error && (
          <p className="workflow-error" role="alert">
            Cover request failed: {error}
          </p>
        )}
        {!loading && result && !result.artwork && (
          <p>
            No front cover is indexed for this release. Library artwork remains
            unchanged.
          </p>
        )}
      </div>

      {!loading && result?.artwork && (
        <figure className="candidate-artwork-preview">
          <img
            alt={`Cover Art Archive front cover for ${candidate.title}`}
            src={result.artwork.previewDataUrl}
          />
          <figcaption>
            <strong>Read-only release front cover</strong>
            <span>
              {result.artwork.types.length > 0
                ? result.artwork.types.join(", ")
                : "No artwork type supplied"}
              {" · "}
              {result.artwork.approved
                ? "Approved in MusicBrainz"
                : "Pending MusicBrainz approval"}
            </span>
            <span>
              {result.artwork.width} × {result.artwork.height} ·{" "}
              {formatBytes(result.artwork.byteLength)}
            </span>
            {result.artwork.comment && <span>{result.artwork.comment}</span>}
            <span>
              Loaded from {sourceLabel(result.source)}. No Library artwork
              changed.
            </span>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
