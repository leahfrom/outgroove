import type {
  AcoustIdTrackLookupResultDto,
  AcoustIdTrackPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogTrack } from "../../shared/domain/catalog";
import { formatDuration } from "../../shared/domain/audio-technical";

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
        <span>Identify recording with AcoustID</span>
        <small>
          Optional local fingerprint · explicit network confirmation
        </small>
      </summary>
      <div className="track-identification-body">
        <p>
          Outgroove can analyze this file locally with Chromaprint. No audio,
          path, artwork, or existing tags are uploaded. After the local preview,
          you separately decide whether to send only the fingerprint and whole
          duration to AcoustID.
        </p>
        {!preview && !result && (
          <div className="actions">
            <button disabled={busy} onClick={onPreview} type="button">
              {busy ? "Fingerprinting locally…" : "Create local fingerprint"}
            </button>
            {busy && (
              <button onClick={onCancel} type="button">
                Cancel fingerprinting
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            aria-label="AcoustID identification error"
            className="workflow-error"
            role="alert"
          >
            <strong>Identification stopped</strong>
            <p>{error}</p>
            <button onClick={onCancel} type="button">
              Clear
            </button>
          </div>
        )}

        {preview && (
          <section
            aria-label="Confirm AcoustID fingerprint lookup"
            className="confirmation-stage"
          >
            <h4>Review the exact outgoing data</h4>
            <dl className="track-identification-payload">
              <div>
                <dt>Algorithm</dt>
                <dd>{preview.sent.fingerprintAlgorithm}</dd>
              </div>
              <div>
                <dt>Whole duration</dt>
                <dd>{formatDuration(preview.sent.durationSeconds)}</dd>
              </div>
              <div>
                <dt>Fingerprint length</dt>
                <dd>{preview.sent.fingerprintCharacters} characters</dd>
              </div>
              <div>
                <dt>Fingerprint SHA-256</dt>
                <dd className="identifier">{preview.sent.fingerprintSha256}</dd>
              </div>
            </dl>
            <p>
              The fingerprint itself remains inside main until you confirm.
              AcoustID may return several possible recordings; no result is
              selected or written automatically.
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={onConfirm}
                type="button"
              >
                {busy ? "Checking AcoustID…" : "Send fingerprint to AcoustID"}
              </button>
              <button onClick={onCancel} type="button">
                {busy ? "Cancel lookup" : "Discard fingerprint"}
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
                    ? "Fresh AcoustID response"
                    : result.source === "cache"
                      ? "Cached AcoustID response"
                      : "Stale cached response; AcoustID was unavailable"}
                </p>
              </div>
              <button onClick={onCancel} type="button">
                Close results
              </button>
            </header>
            {result.candidates.length === 0 ? (
              <p>No AcoustID candidates matched this fingerprint.</p>
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
                          {Math.round(candidate.score * 100)}% fingerprint
                          similarity
                        </strong>
                      </header>
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
                            ? "Recording ID already set"
                            : "Use recording ID in tag draft"}
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
