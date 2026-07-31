import type {
  AcoustIdTrackLookupResultDto,
  AcoustIdTrackPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogTrack } from "../../shared/domain/catalog";
import { formatDuration } from "../../shared/domain/audio-technical";
import { ProviderRequestError } from "./provider-request-error";

function artistLabel(
  candidate: AcoustIdTrackLookupResultDto["candidates"][number],
): string {
  return candidate.artists.length > 0
    ? candidate.artists.map((artist) => artist.name).join(", ")
    : "Artist unavailable";
}

export function TrackAcoustIdIdentification({
  busy,
  error,
  preview,
  result,
  track,
  onCancel,
  onConfirm,
  onPreview,
  onUseRecordingId,
}: {
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly preview: AcoustIdTrackPreviewDto | undefined;
  readonly result: AcoustIdTrackLookupResultDto | undefined;
  readonly track: CatalogTrack;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onPreview: () => void;
  readonly onUseRecordingId: (recordingId: string) => void;
}): React.JSX.Element {
  const active = busy || Boolean(error) || Boolean(preview) || Boolean(result);
  return (
    <details className="track-identification" open={active}>
      <summary>
        <span>Try identifying this recording</span>
        <small>Creates a fingerprint here before connecting</small>
      </summary>
      <div className="track-identification-body">
        <p>
          Outgroove can create a fingerprint from this file on your device. Your
          audio, file path, artwork, and tags are never uploaded. You decide
          separately whether to send the fingerprint and track length to
          AcoustID.
        </p>
        {!preview && !result && (
          <div className="actions">
            <button disabled={busy} onClick={onPreview} type="button">
              {busy ? "Creating fingerprint…" : "Create fingerprint"}
            </button>
            {busy && (
              <button onClick={onCancel} type="button">
                Cancel
              </button>
            )}
          </div>
        )}

        {error && (
          <>
            <ProviderRequestError
              details={[error]}
              guidance={
                preview
                  ? "Your fingerprint is still ready and no metadata changed. Check your connection, then send it again when you’re ready."
                  : "No metadata changed and nothing was sent. If the file changed, rescan it before creating a new fingerprint."
              }
              label="AcoustID identification error"
              title={
                preview
                  ? "AcoustID couldn’t finish this lookup."
                  : "Outgroove couldn’t create this fingerprint."
              }
            />
            <button onClick={onCancel} type="button">
              Clear
            </button>
          </>
        )}

        {preview && (
          <section
            aria-label="Confirm AcoustID fingerprint lookup"
            className="confirmation-stage"
          >
            <h4>Review what will be sent</h4>
            <dl className="track-identification-payload">
              <div>
                <dt>Track length</dt>
                <dd>{formatDuration(preview.sent.durationSeconds)}</dd>
              </div>
            </dl>
            <details className="metadata-more-fields">
              <summary>
                <span>Technical fingerprint details</span>
                <small>Algorithm, size, and verification hash</small>
              </summary>
              <dl className="track-identification-payload">
                <div>
                  <dt>Algorithm</dt>
                  <dd>{preview.sent.fingerprintAlgorithm}</dd>
                </div>
                <div>
                  <dt>Fingerprint length</dt>
                  <dd>{preview.sent.fingerprintCharacters} characters</dd>
                </div>
                <div>
                  <dt>Fingerprint SHA-256</dt>
                  <dd className="identifier">
                    {preview.sent.fingerprintSha256}
                  </dd>
                </div>
              </dl>
            </details>
            <p>
              The fingerprint stays on this device until you confirm. AcoustID
              may suggest several recordings; Outgroove will not choose or write
              any result automatically.
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={onConfirm}
                type="button"
              >
                {busy ? "Checking AcoustID…" : "Send and find matches"}
              </button>
              <button onClick={onCancel} type="button">
                {busy ? "Cancel search" : "Discard fingerprint"}
              </button>
            </div>
          </section>
        )}

        {result && (
          <section
            aria-label="AcoustID recording candidates"
            className="track-identification-results"
          >
            <header>
              <div>
                <h4>Possible recordings</h4>
                <p>
                  {result.source === "network"
                    ? "Results from AcoustID"
                    : result.source === "cache"
                      ? "Saved results"
                      : "Older saved results; AcoustID was unavailable"}
                </p>
              </div>
              <button onClick={onCancel} type="button">
                Close results
              </button>
            </header>
            {result.candidates.length === 0 ? (
              <p>No recordings matched this fingerprint.</p>
            ) : (
              <ol>
                {result.candidates.map((candidate) => (
                  <li
                    key={`${candidate.acoustId}:${candidate.recordingId ?? "unknown"}`}
                  >
                    <article>
                      <header>
                        <div>
                          <h5>
                            {candidate.title ?? "Recording details unavailable"}
                          </h5>
                          <p>{artistLabel(candidate)}</p>
                        </div>
                        <strong>
                          {Math.round(candidate.score * 100)}% fingerprint match
                        </strong>
                      </header>
                      <dl>
                        <div>
                          <dt>Known duration</dt>
                          <dd>
                            {candidate.durationSeconds === null
                              ? "Not provided"
                              : formatDuration(candidate.durationSeconds)}
                          </dd>
                        </div>
                      </dl>
                      {candidate.releaseGroups.length > 0 && (
                        <p>
                          Releases:{" "}
                          {candidate.releaseGroups
                            .map((release) =>
                              release.type
                                ? `${release.title} (${release.type})`
                                : release.title,
                            )
                            .join(" · ")}
                        </p>
                      )}
                      <details className="metadata-more-fields">
                        <summary>
                          <span>MusicBrainz and AcoustID IDs</span>
                          <small>AcoustID and MusicBrainz references</small>
                        </summary>
                        <dl>
                          <div>
                            <dt>MusicBrainz recording ID</dt>
                            <dd className="identifier">
                              {candidate.recordingId ?? "Not provided"}
                            </dd>
                          </div>
                          <div>
                            <dt>AcoustID</dt>
                            <dd className="identifier">{candidate.acoustId}</dd>
                          </div>
                        </dl>
                      </details>
                      {candidate.recordingId && (
                        <button
                          disabled={
                            track.tags.musicBrainzRecordingId ===
                            candidate.recordingId
                          }
                          onClick={() =>
                            candidate.recordingId &&
                            onUseRecordingId(candidate.recordingId)
                          }
                          type="button"
                        >
                          {track.tags.musicBrainzRecordingId ===
                          candidate.recordingId
                            ? "This match is already saved"
                            : "Use this match in the draft"}
                        </button>
                      )}
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </details>
  );
}
