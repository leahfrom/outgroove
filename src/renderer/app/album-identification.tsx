import type {
  AlbumIdentificationResultDto,
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
import { ModalSheet } from "./modal-sheet";
import {
  MusicBrainzTrackMapper,
  type MusicBrainzTrackMappingEdit,
} from "./musicbrainz-track-mapper";

export function AlbumIdentification({
  album,
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
  onCancelMappingPreview,
  onCancelReleaseTracks,
  onClose,
  onConfirmMapping,
  onCreateDraft,
  onLoadReleaseTracks,
  onPreviewMapping,
  onSearch,
}: {
  readonly album: CatalogAlbum;
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
  readonly onCancelMappingPreview: () => void;
  readonly onCancelReleaseTracks: () => void;
  readonly onClose: () => void;
  readonly onConfirmMapping: () => void;
  readonly onCreateDraft: (candidate: ComparedAlbumCandidate) => void;
  readonly onLoadReleaseTracks: (candidate: ComparedAlbumCandidate) => void;
  readonly onPreviewMapping: (
    edits: readonly MusicBrainzTrackMappingEdit[],
  ) => void;
  readonly onSearch: () => void;
}): React.JSX.Element {
  return (
    <ModalSheet
      ariaLabel={`Find MusicBrainz matches for ${album.title}`}
      className="album-identification-sheet"
      closeLabel="Close match finder"
      onClose={onClose}
    >
      <header className="identification-heading">
        <p className="eyebrow">Album identification</p>
        <h2>Find MusicBrainz matches</h2>
        <p>
          Compare this Library album with release editions in MusicBrainz, then
          explicitly choose one to prepare a limited metadata draft. Searching
          and choosing a candidate cannot preview, apply, or write metadata.
        </p>
      </header>

      <section
        aria-labelledby="musicbrainz-privacy-heading"
        className="card identification-privacy"
      >
        <h3 id="musicbrainz-privacy-heading">Before connecting</h3>
        <p>
          Searching sends only the album title “{album.title}” and album artist
          “{album.albumArtist}” to MusicBrainz. Outgroove never sends audio,
          artwork, file paths, native tags, or fingerprints in this search.
        </p>
        <p>
          Track count, release date, and catalog number comparisons happen
          locally after results return.
        </p>
        <div className="actions">
          <button
            className="primary"
            disabled={loading || releaseTracksLoading}
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
          `${result.candidates.length} candidate${
            result.candidates.length === 1 ? "" : "s"
          } loaded from ${
            result.source === "network"
              ? "MusicBrainz"
              : result.source === "cache"
                ? "the local cache"
                : "an expired local cache because MusicBrainz was unavailable"
          }. No Library metadata changed.`}
      </div>

      {result && !loading && (
        <section aria-label="MusicBrainz release candidates">
          {result.candidates.length === 0 ? (
            <div className="card identification-empty">
              <h3>No candidates found</h3>
              <p>
                MusicBrainz returned no release editions for this title and
                artist. The Library album remains unchanged.
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
                          {candidate.confidence} · {candidate.score}/100
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
                        <div>
                          <dt>MusicBrainz release ID</dt>
                          <dd className="identifier">{candidate.releaseId}</dd>
                        </div>
                      </dl>
                      <div className="candidate-evidence">
                        <div>
                          <h4>Matches</h4>
                          {candidate.matches.length > 0 ? (
                            <ul>
                              {candidate.matches.map((match) => (
                                <li key={match}>{match}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>None of the compared fields match.</p>
                          )}
                        </div>
                        <div>
                          <h4>Conflicts</h4>
                          {candidate.conflicts.length > 0 ? (
                            <ul>
                              {candidate.conflicts.map((conflict) => (
                                <li key={conflict}>{conflict}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>No compared-field conflicts.</p>
                          )}
                        </div>
                      </div>
                      <div className="candidate-draft">
                        <h4>Supported tag draft</h4>
                        {tagDraft.fields.length > 0 ? (
                          <p>
                            {tagDraft.fields
                              .map(({ label }) => label)
                              .join(", ")}
                            . You will review current and proposed values before
                            previewing.
                          </p>
                        ) : (
                          <p>
                            All safely supported values are already current or
                            unavailable.
                          </p>
                        )}
                        <details>
                          <summary>Values not included</summary>
                          <ul>
                            {tagDraft.omissions.map((omission) => (
                              <li key={omission}>{omission}</li>
                            ))}
                          </ul>
                        </details>
                        <button
                          aria-label={`Draft supported tags from ${candidate.title}, ${candidate.date ?? "unknown date"}`}
                          className="primary"
                          disabled={tagDraft.fields.length === 0}
                          onClick={() => onCreateDraft(candidate)}
                          type="button"
                        >
                          Draft supported tags from this release
                        </button>
                        <button
                          aria-label={`Map Library tracks to ${candidate.title}, ${candidate.date ?? "unknown date"}`}
                          disabled={releaseTracksLoading}
                          onClick={() => onLoadReleaseTracks(candidate)}
                          type="button"
                        >
                          Map tracks from this release
                        </button>
                        {releaseTracksReleaseId === candidate.releaseId &&
                          releaseTracksLoading && (
                            <div
                              aria-live="polite"
                              className="identification-status"
                              role="status"
                            >
                              Loading the selected release tracklist…
                              <button
                                onClick={onCancelReleaseTracks}
                                type="button"
                              >
                                Cancel tracklist request
                              </button>
                            </div>
                          )}
                        {releaseTracksReleaseId === candidate.releaseId &&
                          !releaseTracksLoading &&
                          releaseTracksError && (
                            <p className="workflow-error" role="alert">
                              Tracklist request failed: {releaseTracksError}
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
