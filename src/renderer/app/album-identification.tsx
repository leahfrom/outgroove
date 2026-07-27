import type { AlbumIdentificationResultDto } from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import { ModalSheet } from "./modal-sheet";

export function AlbumIdentification({
  album,
  error,
  loading,
  result,
  onCancel,
  onClose,
  onSearch,
}: {
  readonly album: CatalogAlbum;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly result: AlbumIdentificationResultDto | undefined;
  readonly onCancel: () => void;
  readonly onClose: () => void;
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
        <p className="eyebrow">Read-only album identification</p>
        <h2>Find MusicBrainz matches</h2>
        <p>
          Compare this Library album with release editions in MusicBrainz. This
          step cannot propose, apply, or write metadata.
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
            disabled={loading}
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
              {result.candidates.map((candidate) => (
                <li key={candidate.releaseId}>
                  <article className="card identification-candidate">
                    <header>
                      <div>
                        <h3>{candidate.title}</h3>
                        <p>{candidate.artistCredit || "Artist not provided"}</p>
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
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </ModalSheet>
  );
}
