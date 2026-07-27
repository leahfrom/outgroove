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
  prepareError,
  preparing,
  result,
  onCancel,
  onLoad,
  onPrepare,
}: {
  readonly candidate: ComparedAlbumCandidate;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly prepareError: string | undefined;
  readonly preparing: boolean;
  readonly result: CoverArtArchiveResultDto | undefined;
  readonly onCancel: () => void;
  readonly onLoad: () => void;
  readonly onPrepare: (artworkId: string) => void;
}): React.JSX.Element {
  const artwork = result?.artwork ?? undefined;
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
        The thumbnail is read-only evidence for this exact release. It cannot
        start an artwork write; preparing the original opens a separate,
        confirmable per-file preview.
      </p>
      <div className="workflow-actions">
        <button
          aria-label={`Load Cover Art Archive front cover for ${candidate.title}, ${candidate.date ?? "unknown date"}`}
          disabled={loading || preparing}
          onClick={onLoad}
          type="button"
        >
          {result ? "Reload release front cover" : "Load release front cover"}
        </button>
        {(loading || preparing) && (
          <button onClick={onCancel} type="button">
            {preparing ? "Cancel artwork preparation" : "Cancel cover request"}
          </button>
        )}
      </div>

      <div aria-live="polite">
        {loading && "Loading the release front cover…"}
        {preparing &&
          "Loading and validating the original image for per-file review…"}
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
        {!preparing && prepareError && (
          <p className="workflow-error" role="alert">
            Artwork preparation failed: {prepareError}
          </p>
        )}
      </div>

      {!loading && artwork && (
        <figure className="candidate-artwork-preview">
          <img
            alt={`Cover Art Archive front cover for ${candidate.title}`}
            src={artwork.previewDataUrl}
          />
          <figcaption>
            <strong>Read-only release front cover</strong>
            <span>
              {artwork.types.length > 0
                ? artwork.types.join(", ")
                : "No artwork type supplied"}
              {" · "}
              {artwork.approved
                ? "Approved in MusicBrainz"
                : "Pending MusicBrainz approval"}
            </span>
            <span>
              {artwork.width} × {artwork.height} ·{" "}
              {formatBytes(artwork.byteLength)}
            </span>
            {artwork.comment && <span>{artwork.comment}</span>}
            <span>
              Loaded from {sourceLabel(result?.source ?? "network")}. No Library
              artwork changed.
            </span>
            <span>
              If you continue, Outgroove fetches this exact image’s original
              file and opens the existing per-file artwork review. It still will
              not write until that separate preview is confirmed. Use artwork
              only when you have the right to do so.
            </span>
            <button
              aria-label={`Prepare Cover Art Archive artwork from ${candidate.title}, ${candidate.date ?? "unknown date"}, for replacement review`}
              className="primary"
              disabled={preparing}
              onClick={() => onPrepare(artwork.id)}
              type="button"
            >
              Prepare original for replacement review
            </button>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
