import type {
  AlbumArtworkEditPreviewDto,
  AlbumArtworkExportPreviewDto,
  AlbumArtworkExportResultDto,
  TagEditResultDto,
} from "../../shared/contracts/api";
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

export function AlbumArtworkEditor({
  busy,
  error,
  exportError,
  exportPreview,
  exportResult,
  preview,
  result,
  onCancelPreview,
  onChoose,
  onConfirm,
  onExport,
  onPrepareExport,
}: {
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly exportError: string | undefined;
  readonly exportPreview: AlbumArtworkExportPreviewDto | undefined;
  readonly exportResult: AlbumArtworkExportResultDto | undefined;
  readonly preview: AlbumArtworkEditPreviewDto | undefined;
  readonly result: TagEditResultDto | undefined;
  readonly onCancelPreview: () => void;
  readonly onChoose: () => void;
  readonly onConfirm: () => void;
  readonly onExport: () => void;
  readonly onPrepareExport: () => void;
}): React.JSX.Element {
  const writableFiles = preview?.files.filter((file) => file.willWrite) ?? [];
  const blockedFiles =
    preview?.files.filter((file) => file.warnings.length > 0) ?? [];

  return (
    <section
      className="card album-artwork-editor"
      aria-label="Album artwork editor"
    >
      <WorkbenchDraftHeading
        context="Embedded artwork"
        title="Replace the front cover"
        description="Choose one local JPEG or PNG. Outgroove embeds it only in supported MP3 and FLAC files; folder artwork and every non-front embedded picture remain untouched."
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
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <WorkbenchConfirmation
          blocked={writableFiles.length === 0}
          busy={busy}
          cancelLabel="Choose different artwork"
          confirmLabel={`Confirm and write ${writableFiles.length} ${writableFiles.length === 1 ? "file" : "files"}`}
          description="Outgroove will re-check each file, snapshot its complete embedded picture set, write through a same-folder temporary file, then re-read and verify both artwork and audio payload."
          label="Artwork edit confirmation"
          title="Review the embedded cover change"
          onCancel={onCancelPreview}
          onConfirm={onConfirm}
        >
          <div className="artwork-proposal">
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
                  <dd>{preview.mimeType === "image/jpeg" ? "JPEG" : "PNG"}</dd>
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
          <div className="workbench-file-reviews">
            {preview.files.map((file) => (
              <article key={file.fileId}>
                <h5>{file.path}</h5>
                <p>
                  {file.willWrite
                    ? `Replace ${file.currentFrontCovers} front cover${file.currentFrontCovers === 1 ? "" : "s"}; preserve ${file.preservedPictures} other embedded picture${file.preservedPictures === 1 ? "" : "s"}.`
                    : file.warnings.length === 0
                      ? "Already matches the selected front cover."
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
          label="Artwork edit result"
          results={result.results}
          subject="Artwork write"
        />
      )}

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
              <span>{exportError}</span>
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
              <span>
                {formatBytes(exportResult.byteLength)} · SHA-256{" "}
                {exportResult.sha256}
              </span>
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
