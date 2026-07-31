import type { CoverArtArchiveResultDto } from "../../shared/contracts/api";
import type { ComparedAlbumCandidate } from "../../shared/domain/album-identification";
import { ProviderRequestError } from "./provider-request-error";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
}

function sourceLabel(source: CoverArtArchiveResultDto["source"]): string {
  return source === "network"
    ? "Cover Art Archive"
    : source === "cache"
      ? "a saved copy on this device"
      : "an older saved copy";
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
      <h4>Artwork for this release</h4>
      <p>
        Outgroove can ask the Cover Art Archive for this edition’s front cover.
        Your audio, current artwork, tags, and file paths stay on this device.
      </p>
      <p>
        Viewing the cover cannot change your Library. If you decide to use it,
        Outgroove opens a separate review before changing any file.
      </p>
      <details className="candidate-technical-details">
        <summary>Request details</summary>
        <p>
          Outgroove sends only MusicBrainz release ID{" "}
          <span className="identifier">{candidate.releaseId}</span>.
        </p>
      </details>
      <div className="workflow-actions">
        <button
          aria-label={`Show front cover for ${candidate.title}, ${candidate.date ?? "unknown date"}`}
          disabled={loading || preparing}
          onClick={onLoad}
          type="button"
        >
          {result ? "Reload front cover" : "Show front cover"}
        </button>
        {(loading || preparing) && (
          <button onClick={onCancel} type="button">
            {preparing ? "Cancel preparation" : "Cancel"}
          </button>
        )}
      </div>

      <div aria-live="polite">
        {loading && "Loading the release front cover…"}
        {preparing && "Preparing the full-size image for review…"}
        {!loading && error && (
          <ProviderRequestError
            details={[error]}
            detailsSummary="Cover request technical details"
            guidance="Your current artwork and audio files are unchanged. Check your connection, then request the cover again."
            label={`Cover Art Archive request error for ${candidate.title}`}
            title="The front cover couldn’t be loaded."
          />
        )}
        {!loading && result && !result.artwork && (
          <p>
            No front cover is available for this release. Your Library is
            unchanged.
          </p>
        )}
        {!preparing && prepareError && (
          <ProviderRequestError
            details={[prepareError]}
            detailsSummary="Artwork preparation technical details"
            guidance="Your current artwork and audio files are unchanged. Request the cover again before starting a new review."
            label={`Cover artwork preparation error for ${candidate.title}`}
            title="The full-size cover couldn’t be prepared for review."
          />
        )}
      </div>

      {!loading && artwork && (
        <figure className="candidate-artwork-preview">
          <img
            alt={`Cover Art Archive front cover for ${candidate.title}`}
            src={artwork.previewDataUrl}
          />
          <figcaption>
            <strong>Front cover from this release</strong>
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
              Loaded from {sourceLabel(result?.source ?? "network")}. Your
              Library is unchanged.
            </span>
            <span>
              If you continue, Outgroove downloads the full-size image and lets
              you review every affected file. Nothing is written until you
              confirm that review. Use artwork only when you have the right to
              do so.
            </span>
            <button
              aria-label={`Use front cover from ${candidate.title}, ${candidate.date ?? "unknown date"}`}
              className="primary"
              disabled={preparing}
              onClick={() => onPrepare(artwork.id)}
              type="button"
            >
              Use this cover…
            </button>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
