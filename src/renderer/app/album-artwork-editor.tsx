import type {
  AlbumArtworkEditPreviewDto,
  AlbumArtworkExportPreviewDto,
  AlbumArtworkExportResultDto,
  AlbumFolderArtworkPreviewDto,
  AlbumFolderArtworkResultDto,
  TagEditResultDto,
} from "../../shared/contracts/api";
import { TechnicalDetails } from "./technical-details";
import {
  WorkbenchConfirmation,
  WorkbenchDraftHeading,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
}

function ArtworkVerificationDetails({
  byteLength,
  sha256,
}: {
  readonly byteLength: number;
  readonly sha256: string;
}): React.JSX.Element {
  return (
    <details>
      <summary>File verification details</summary>
      <dl>
        <div>
          <dt>File size</dt>
          <dd>{formatBytes(byteLength)}</dd>
        </div>
        <div>
          <dt>File fingerprint (SHA-256)</dt>
          <dd className="identifier">{sha256}</dd>
        </div>
      </dl>
    </details>
  );
}

export function AlbumArtworkEditor({
  busy,
  error,
  exportError,
  exportPreview,
  exportResult,
  folderError,
  folderPreview,
  folderResult,
  preview,
  result,
  resultAction,
  onCancelPreview,
  onChoose,
  onConfirm,
  onExport,
  onCancelFolderArtwork,
  onConfirmFolderArtwork,
  onPrepareFolderArtwork,
  onPrepareExport,
  onPrepareRemoval,
}: {
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly exportError: string | undefined;
  readonly exportPreview: AlbumArtworkExportPreviewDto | undefined;
  readonly exportResult: AlbumArtworkExportResultDto | undefined;
  readonly folderError?: string | undefined;
  readonly folderPreview?: AlbumFolderArtworkPreviewDto | undefined;
  readonly folderResult?: AlbumFolderArtworkResultDto | undefined;
  readonly preview: AlbumArtworkEditPreviewDto | undefined;
  readonly result: TagEditResultDto | undefined;
  readonly resultAction: "remove" | "replace" | undefined;
  readonly onCancelPreview: () => void;
  readonly onChoose: () => void;
  readonly onConfirm: () => void;
  readonly onExport: () => void;
  readonly onCancelFolderArtwork?: () => void;
  readonly onConfirmFolderArtwork?: () => void;
  readonly onPrepareFolderArtwork?: () => void;
  readonly onPrepareExport: () => void;
  readonly onPrepareRemoval: () => void;
}): React.JSX.Element {
  const writableFiles = preview?.files.filter((file) => file.willWrite) ?? [];
  const blockedFiles =
    preview?.files.filter((file) => file.warnings.length > 0) ?? [];
  const removing = preview?.action === "remove";
  const remoteSource = preview?.proposedArtworkSource;

  return (
    <section
      className="card album-artwork-editor"
      aria-label="Album artwork editor"
    >
      <WorkbenchDraftHeading
        context="Embedded artwork"
        title="Replace the front cover"
        description={
          remoteSource
            ? "Review the validated original image from the exact Cover Art Archive release. Outgroove embeds it only in supported MP3 and FLAC files; folder artwork and every non-front embedded picture remain untouched."
            : "Choose one local JPEG or PNG. Outgroove embeds it only in supported MP3 and FLAC files; folder artwork and every non-front embedded picture remain untouched."
        }
      />
      <div className="workflow-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={onChoose}
          type="button"
        >
          Choose JPEG or PNG
        </button>
      </div>

      {error && (
        <div className="workflow-error" role="alert">
          <strong>The artwork request could not be completed.</strong>
          <span>
            Review the current album or choose the artwork again. No audio file
            is treated as changed until Outgroove verifies it.
          </span>
          <TechnicalDetails messages={[error]} />
        </div>
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={writableFiles.length === 0}
          busy={busy}
          cancelLabel={
            removing
              ? "Return without removing"
              : remoteSource
                ? "Return without replacing"
                : "Choose different artwork"
          }
          confirmLabel={
            removing
              ? `Confirm removal from ${writableFiles.length} ${writableFiles.length === 1 ? "file" : "files"}`
              : `Confirm and write ${writableFiles.length} ${writableFiles.length === 1 ? "file" : "files"}`
          }
          description={
            removing
              ? "Outgroove will check each file again, save its current embedded pictures for recovery, remove only front-cover pictures using a temporary file beside the original, then check that the remaining pictures and music are unchanged."
              : "Outgroove will check each file again, save its current embedded pictures for recovery, write the new cover using a temporary file beside the original, then check both the artwork and music."
          }
          label={
            removing
              ? "Artwork removal confirmation"
              : "Artwork edit confirmation"
          }
          title={
            removing
              ? "Review embedded front-cover removal"
              : "Review the embedded cover change"
          }
          onCancel={onCancelPreview}
          onConfirm={onConfirm}
        >
          {removing ? (
            <div className="artwork-removal-summary">
              <strong>After confirmation: no embedded front cover</strong>
              <span>
                Folder artwork and every embedded picture with another role
                remain untouched. Library may therefore continue to display a
                folder cover.
              </span>
              <span>
                {writableFiles.length} of {preview.files.length} audio files
                will change.
              </span>
            </div>
          ) : (
            <div className="artwork-proposal">
              {remoteSource && (
                <p className="metadata-draft-source">
                  Cover Art Archive original from exact MusicBrainz release{" "}
                  <span className="identifier">{remoteSource.releaseId}</span>,
                  artwork{" "}
                  <span className="identifier">{remoteSource.artworkId}</span>.
                  This is the proposed image shown below; nothing has been
                  written.
                </p>
              )}
              {preview.proposedArtworkDataUrl && (
                <img
                  alt="Proposed album cover"
                  src={preview.proposedArtworkDataUrl}
                />
              )}
              <dl>
                {preview.mimeType && (
                  <div>
                    <dt>Format</dt>
                    <dd>
                      {preview.mimeType === "image/jpeg" ? "JPEG" : "PNG"}
                    </dd>
                  </div>
                )}
                {preview.width && preview.height && (
                  <div>
                    <dt>Dimensions</dt>
                    <dd>
                      {preview.width} × {preview.height}
                    </dd>
                  </div>
                )}
                {preview.byteLength && (
                  <div>
                    <dt>File size</dt>
                    <dd>{formatBytes(preview.byteLength)}</dd>
                  </div>
                )}
                <div>
                  <dt>Will write</dt>
                  <dd>
                    {writableFiles.length} of {preview.files.length} audio files
                  </dd>
                </div>
              </dl>
            </div>
          )}
          <div className="workbench-file-reviews">
            {preview.files.map((file) => (
              <article key={file.fileId}>
                <h5>{file.path}</h5>
                <p>
                  {file.willWrite
                    ? removing
                      ? `Remove ${file.currentFrontCovers} embedded front cover${file.currentFrontCovers === 1 ? "" : "s"}; preserve ${file.preservedPictures} other embedded picture${file.preservedPictures === 1 ? "" : "s"}.`
                      : `Replace ${file.currentFrontCovers} front cover${file.currentFrontCovers === 1 ? "" : "s"}; preserve ${file.preservedPictures} other embedded picture${file.preservedPictures === 1 ? "" : "s"}.`
                    : file.warnings.length === 0
                      ? removing
                        ? "No embedded front cover; this file stays unchanged."
                        : "Already matches the selected front cover."
                      : "Will not be written."}
                </p>
                {file.warnings.map((warning) => (
                  <p className="workflow-error" key={warning} role="alert">
                    {warning}
                  </p>
                ))}
              </article>
            ))}
          </div>
          {blockedFiles.length > 0 && writableFiles.length > 0 && (
            <p className="workflow-note">
              Blocked files remain unchanged; confirmed supported files are
              handled independently.
            </p>
          )}
        </WorkbenchConfirmation>
      )}

      {result && (
        <WorkbenchWriteResult
          label={
            resultAction === "remove"
              ? "Artwork removal result"
              : "Artwork edit result"
          }
          results={result.results}
          subject={
            resultAction === "remove" ? "Artwork removal" : "Artwork write"
          }
        />
      )}

      <details className="artwork-export-disclosure">
        <summary>
          <span>
            <strong>Create folder artwork</strong>
            <small>
              Optional compatibility for players that require a conventional
              cover file.
            </small>
          </span>
        </summary>
        <div className="artwork-export-content">
          <p>
            Outgroove can copy the current embedded cover to a new{" "}
            <strong>cover.jpg</strong> or <strong>cover.png</strong> beside a
            single-folder album. It never runs automatically and never replaces
            existing folder artwork.
          </p>

          {folderError && (
            <div className="workflow-error" role="alert">
              <strong>Folder artwork could not be prepared.</strong>
              <span>
                Review the album folder and try again. No file was created.
              </span>
              <TechnicalDetails messages={[folderError]} />
            </div>
          )}

          {folderPreview && (
            <WorkbenchConfirmation
              blocked={false}
              busy={busy}
              cancelLabel="Keep embedded artwork only"
              confirmLabel="Confirm and create folder artwork"
              description="Outgroove will re-check the album folder and embedded cover, write a same-folder temporary image, install only a missing destination, then verify it byte-for-byte. Audio files remain unchanged."
              label="Folder artwork confirmation"
              onCancel={() => onCancelFolderArtwork?.()}
              onConfirm={() => onConfirmFolderArtwork?.()}
              title="Review optional folder artwork"
            >
              <div className="artwork-proposal">
                <img
                  alt="Embedded cover prepared for folder artwork"
                  src={folderPreview.artworkDataUrl}
                />
                <dl>
                  <div>
                    <dt>Format</dt>
                    <dd>
                      {folderPreview.mimeType === "image/jpeg" ? "JPEG" : "PNG"}
                    </dd>
                  </div>
                  <div>
                    <dt>Dimensions</dt>
                    <dd>
                      {folderPreview.width} × {folderPreview.height}
                    </dd>
                  </div>
                  <div>
                    <dt>File size</dt>
                    <dd>{formatBytes(folderPreview.byteLength)}</dd>
                  </div>
                  <div>
                    <dt>Exact destination</dt>
                    <dd className="artwork-export-path">
                      {folderPreview.destinationPath}
                    </dd>
                  </div>
                </dl>
              </div>
            </WorkbenchConfirmation>
          )}

          {folderResult && (
            <div
              className="workflow-result artwork-export-result"
              aria-label="Folder artwork result"
              role="status"
            >
              <strong>Folder artwork created and verified.</strong>
              <span className="artwork-export-path">
                {folderResult.destinationPath}
              </span>
              <ArtworkVerificationDetails
                byteLength={folderResult.byteLength}
                sha256={folderResult.sha256}
              />
            </div>
          )}

          {!folderPreview && (
            <div className="workflow-actions">
              <button
                disabled={busy}
                onClick={() => onPrepareFolderArtwork?.()}
                type="button"
              >
                {folderResult
                  ? "Prepare another folder cover"
                  : "Preview folder artwork"}
              </button>
            </div>
          )}
        </div>
      </details>

      <details className="artwork-export-disclosure artwork-removal-disclosure">
        <summary>
          <span>
            <strong>Remove embedded front covers</strong>
            <small>
              Prepare a reversible per-file removal without touching folder
              artwork.
            </small>
          </span>
        </summary>
        <div className="artwork-export-content">
          <p>
            Removal affects only pictures explicitly marked as front covers.
            Outgroove preserves other embedded pictures and stores the complete
            before-state for a separately confirmed undo.
          </p>
          {preview?.action !== "remove" && (
            <div className="workflow-actions">
              <button
                className="artwork-removal-button"
                disabled={busy}
                onClick={onPrepareRemoval}
                type="button"
              >
                Preview front-cover removal
              </button>
            </div>
          )}
        </div>
      </details>

      <details className="artwork-export-disclosure">
        <summary>
          <span>
            <strong>Export current artwork</strong>
            <small>
              Save the cover Outgroove currently displays without changing
              audio.
            </small>
          </span>
        </summary>
        <div className="artwork-export-content">
          <p>
            Preparing is read-only. Export uses a native save dialog, verifies
            the new file byte-for-byte, and refuses to replace a file that
            already exists.
          </p>

          {exportError && (
            <div className="workflow-error" role="alert">
              <strong>The artwork could not be exported.</strong>
              <span>
                Choose a destination or prepare the export again. Audio files
                remain unchanged.
              </span>
              <TechnicalDetails messages={[exportError]} />
            </div>
          )}

          {exportPreview && (
            <div
              className="artwork-export-preview"
              aria-label="Artwork export preview"
            >
              <div className="artwork-proposal">
                <img
                  alt="Artwork prepared for export"
                  src={exportPreview.artworkDataUrl}
                />
                <dl>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {exportPreview.source === "embedded"
                        ? "Embedded artwork"
                        : "Folder artwork"}
                    </dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>
                      {exportPreview.mimeType === "image/jpeg" ? "JPEG" : "PNG"}
                    </dd>
                  </div>
                  <div>
                    <dt>Dimensions</dt>
                    <dd>
                      {exportPreview.width} × {exportPreview.height}
                    </dd>
                  </div>
                  <div>
                    <dt>File size</dt>
                    <dd>{formatBytes(exportPreview.byteLength)}</dd>
                  </div>
                </dl>
              </div>
              <div className="workflow-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={onExport}
                  type="button"
                >
                  Export this artwork…
                </button>
              </div>
            </div>
          )}

          {exportResult && (
            <div
              className="workflow-result artwork-export-result"
              aria-label="Artwork export result"
              role="status"
            >
              <strong>Artwork exported and verified.</strong>
              <span className="artwork-export-path">
                {exportResult.destinationPath}
              </span>
              <ArtworkVerificationDetails
                byteLength={exportResult.byteLength}
                sha256={exportResult.sha256}
              />
            </div>
          )}

          {!exportPreview && (
            <div className="workflow-actions">
              <button disabled={busy} onClick={onPrepareExport} type="button">
                {exportResult
                  ? "Prepare another export"
                  : "Prepare artwork export"}
              </button>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
