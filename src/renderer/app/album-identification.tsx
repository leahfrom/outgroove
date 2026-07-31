import type {
  AlbumIdentificationResultDto,
  CoverArtArchiveResultDto,
  MusicBrainzReleaseTracklistDto,
  TagEditResultDto,
  TrackBatchEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  createAlbumCandidateTagDraft,
  formatArtistCredits,
  type ComparedAlbumCandidate,
} from "../../shared/domain/album-identification";
import { CoverArtArchivePreview } from "./cover-art-archive-preview";
import { ModalSheet } from "./modal-sheet";
import {
  MusicBrainzTrackMapper,
  type MusicBrainzTrackMappingEdit,
} from "./musicbrainz-track-mapper";

export function AlbumIdentification({
  album,
  coverArtError,
  coverArtLoading,
  coverArtPrepareError,
  coverArtPreparing,
  coverArtReleaseId,
  coverArtResult,
  error,
  loading,
  mappingBusy,
  mappingError,
  mappingPreview,
  mappingResult,
  releaseTracksError,
  releaseTracksLoading,
  releaseTracksReleaseId,
  releaseTracksResult,
  result,
  onCancel,
  onCancelCoverArt,
  onCancelMappingPreview,
  onCancelReleaseTracks,
  onClose,
  onConfirmMapping,
  onCreateDraft,
  onLoadReleaseTracks,
  onLoadCoverArt,
  onPrepareCoverArt,
  onPreviewMapping,
  onSearch,
}: {
  readonly album: CatalogAlbum;
  readonly coverArtError: string | undefined;
  readonly coverArtLoading: boolean;
  readonly coverArtPrepareError: string | undefined;
  readonly coverArtPreparing: boolean;
  readonly coverArtReleaseId: string | undefined;
  readonly coverArtResult: CoverArtArchiveResultDto | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly mappingBusy: boolean;
  readonly mappingError: string | undefined;
  readonly mappingPreview: TrackBatchEditPreviewDto | undefined;
  readonly mappingResult: TagEditResultDto | undefined;
  readonly releaseTracksError: string | undefined;
  readonly releaseTracksLoading: boolean;
  readonly releaseTracksReleaseId: string | undefined;
  readonly releaseTracksResult: MusicBrainzReleaseTracklistDto | undefined;
  readonly result: AlbumIdentificationResultDto | undefined;
  readonly onCancel: () => void;
  readonly onCancelCoverArt: () => void;
  readonly onCancelMappingPreview: () => void;
  readonly onCancelReleaseTracks: () => void;
  readonly onClose: () => void;
  readonly onConfirmMapping: () => void;
  readonly onCreateDraft: (candidate: ComparedAlbumCandidate) => void;
  readonly onLoadReleaseTracks: (candidate: ComparedAlbumCandidate) => void;
  readonly onLoadCoverArt: (candidate: ComparedAlbumCandidate) => void;
  readonly onPrepareCoverArt: (
    candidate: ComparedAlbumCandidate,
    artworkId: string,
  ) => void;
  readonly onPreviewMapping: (
    edits: readonly MusicBrainzTrackMappingEdit[],
  ) => void;
  readonly onSearch: () => void;
}): React.JSX.Element {
  return (
    <ModalSheet
      ariaLabel={`Find album details for ${album.title}`}
      className="album-identification-sheet"
      closeLabel="Close album search"
      onClose={onClose}
    >
      <header className="identification-heading">
        <p className="eyebrow">Find album details</p>
        <h2>Find this album on MusicBrainz</h2>
        <p>
          Search for possible editions, compare the details, and choose the one
          that fits. Your choice only fills in a draft—you still review and
          confirm every change before Outgroove writes anything.
        </p>
      </header>

      <section
        aria-labelledby="musicbrainz-privacy-heading"
        className="card identification-privacy"
      >
        <h3 id="musicbrainz-privacy-heading">Before connecting</h3>
        <p>
          Searching sends only the album title “{album.title}” and album artist
          “{album.albumArtist}” to MusicBrainz. Your audio, artwork, file paths,
          tags, and fingerprints stay on this device.
        </p>
        <p>
          Outgroove compares track count, release date, and catalog number on
          this device after the results arrive.
        </p>
        <div className="actions">
          <button
            className="primary"
            disabled={
              loading ||
              releaseTracksLoading ||
              coverArtLoading ||
              coverArtPreparing
            }
            onClick={onSearch}
            type="button"
          >
            {result ? "Search again" : "Search MusicBrainz"}
          </button>
          {loading && (
            <button onClick={onCancel} type="button">
              Cancel search
            </button>
          )}
        </div>
      </section>

      <div aria-live="polite" className="identification-status" role="status">
        {loading && "Searching MusicBrainz…"}
        {!loading && error && `Search failed: ${error}`}
        {!loading &&
          result &&
          `${result.candidates.length} possible ${
            result.candidates.length === 1 ? "match" : "matches"
          } found using ${
            result.source === "network"
              ? "MusicBrainz"
              : result.source === "cache"
                ? "a saved result"
                : "an older saved result because MusicBrainz was unavailable"
          }. Your Library is unchanged.`}
      </div>

      {result && !loading && (
        <section aria-label="MusicBrainz release candidates">
          {result.candidates.length === 0 ? (
            <div className="card identification-empty">
              <h3>No matches found</h3>
              <p>
                MusicBrainz did not find an edition with this title and artist.
                You can try again later or keep the album as it is.
              </p>
            </div>
          ) : (
            <ol className="identification-candidates">
              {result.candidates.map((candidate) => {
                const tagDraft = createAlbumCandidateTagDraft(album, candidate);
                return (
                  <li key={candidate.releaseId}>
                    <article className="card identification-candidate">
                      <header>
                        <div>
                          <h3>{candidate.title}</h3>
                          <p>
                            {formatArtistCredits(candidate.artistCredits) ||
                              "Artist not provided"}
                          </p>
                        </div>
                        <span
                          className={`candidate-confidence ${candidate.confidence}`}
                        >
                          {candidate.confidence === "strong"
                            ? "Strong match"
                            : candidate.confidence === "possible"
                              ? "Possible match"
                              : "Weak match"}{" "}
                          · {candidate.score}%
                        </span>
                      </header>
                      <dl>
                        <div>
                          <dt>Release</dt>
                          <dd>
                            {candidate.date ?? "Date unknown"} ·{" "}
                            {candidate.country ?? "Country unknown"}
                          </dd>
                        </div>
                        <div>
                          <dt>Edition</dt>
                          <dd>
                            {candidate.status ?? "Status unknown"} ·{" "}
                            {candidate.trackCount ?? "Unknown"} tracks
                          </dd>
                        </div>
                      </dl>
                      <div className="candidate-evidence">
                        <div>
                          <h4>Why it may match</h4>
                          {candidate.matches.length > 0 ? (
                            <ul>
                              {candidate.matches.map((match) => (
                                <li key={match}>{match}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>No compared details match.</p>
                          )}
                        </div>
                        <div>
                          <h4>Things to check</h4>
                          {candidate.conflicts.length > 0 ? (
                            <ul>
                              {candidate.conflicts.map((conflict) => (
                                <li key={conflict}>{conflict}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>No differences found in the compared details.</p>
                          )}
                        </div>
                      </div>
                      <details className="candidate-technical-details">
                        <summary>MusicBrainz details</summary>
                        <dl>
                          <div>
                            <dt>Release ID</dt>
                            <dd className="identifier">
                              {candidate.releaseId}
                            </dd>
                          </div>
                          <div>
                            <dt>Release group ID</dt>
                            <dd className="identifier">
                              {candidate.releaseGroupId ?? "Not provided"}
                            </dd>
                          </div>
                        </dl>
                      </details>
                      <CoverArtArchivePreview
                        candidate={candidate}
                        error={
                          coverArtReleaseId === candidate.releaseId
                            ? coverArtError
                            : undefined
                        }
                        loading={
                          coverArtReleaseId === candidate.releaseId &&
                          coverArtLoading
                        }
                        prepareError={
                          coverArtReleaseId === candidate.releaseId
                            ? coverArtPrepareError
                            : undefined
                        }
                        preparing={
                          coverArtReleaseId === candidate.releaseId &&
                          coverArtPreparing
                        }
                        result={
                          coverArtResult?.sent.releaseId === candidate.releaseId
                            ? coverArtResult
                            : undefined
                        }
                        onCancel={onCancelCoverArt}
                        onLoad={() => onLoadCoverArt(candidate)}
                        onPrepare={(artworkId) =>
                          onPrepareCoverArt(candidate, artworkId)
                        }
                      />
                      <div className="candidate-draft">
                        <h4>Details Outgroove can fill in</h4>
                        {tagDraft.fields.length > 0 ? (
                          <p>
                            {tagDraft.fields
                              .map(({ label }) => label)
                              .join(", ")}
                            . These become a draft for you to review.
                          </p>
                        ) : (
                          <p>
                            All safely supported values are already current or
                            unavailable.
                          </p>
                        )}
                        <details>
                          <summary>Details Outgroove won’t change</summary>
                          <ul>
                            {tagDraft.omissions.map((omission) => (
                              <li key={omission}>{omission}</li>
                            ))}
                          </ul>
                        </details>
                        <button
                          aria-label={`Use album details from ${candidate.title}, ${candidate.date ?? "unknown date"}`}
                          className="primary"
                          disabled={tagDraft.fields.length === 0}
                          onClick={() => onCreateDraft(candidate)}
                          type="button"
                        >
                          Use these album details
                        </button>
                        <button
                          aria-label={`Match Library tracks with ${candidate.title}, ${candidate.date ?? "unknown date"}`}
                          disabled={releaseTracksLoading}
                          onClick={() => onLoadReleaseTracks(candidate)}
                          type="button"
                        >
                          Match tracks one by one
                        </button>
                        {releaseTracksReleaseId === candidate.releaseId &&
                          releaseTracksLoading && (
                            <div
                              aria-live="polite"
                              className="identification-status"
                              role="status"
                            >
                              Loading tracks from this release…
                              <button
                                onClick={onCancelReleaseTracks}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        {releaseTracksReleaseId === candidate.releaseId &&
                          !releaseTracksLoading &&
                          releaseTracksError && (
                            <p className="workflow-error" role="alert">
                              Could not load the tracks: {releaseTracksError}
                            </p>
                          )}
                      </div>
                      {releaseTracksResult?.release.releaseId ===
                        candidate.releaseId && (
                        <MusicBrainzTrackMapper
                          album={album}
                          busy={mappingBusy}
                          error={mappingError}
                          preview={mappingPreview}
                          releaseResult={releaseTracksResult}
                          result={mappingResult}
                          onCancelPreview={onCancelMappingPreview}
                          onConfirm={onConfirmMapping}
                          onPreview={onPreviewMapping}
                        />
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </ModalSheet>
  );
}
