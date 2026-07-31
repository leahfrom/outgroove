import { forwardRef, type Ref } from "react";

import type {
  AlbumArtworkEditPreviewDto,
  TagEditHistoryItemDto,
  TagEditPreviewDto,
  TagEditResultDto,
  TrackBatchEditPreviewDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import {
  WorkbenchConfirmation,
  WorkbenchDraftHeading,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

export type AlbumTitleSection = "edit" | "history";
export type BatchUndoKind =
  "shared-fields" | "track-order" | "musicbrainz-mapping";

function historyLabel(item: TagEditHistoryItemDto): string {
  switch (item.kind) {
    case "album-title-edit":
      return `Changed title to “${item.proposedTitle}”`;
    case "album-title-undo":
      return `Restored “${item.proposedTitle}”`;
    case "album-artwork-edit":
      return item.proposedTitle === "Remove embedded front cover"
        ? "Removed embedded front cover"
        : "Replaced embedded front cover";
    case "album-artwork-undo":
      return "Restored embedded artwork";
    default:
      return item.proposedTitle;
  }
}

function historyOutcome(item: TagEditHistoryItemDto): string {
  const confirmed = `${item.verifiedFiles} ${item.verifiedFiles === 1 ? "file" : "files"} confirmed`;
  if (item.failedFiles === 0) return confirmed;
  return `${confirmed}; ${item.failedFiles} ${item.failedFiles === 1 ? "file" : "files"} couldn’t be confirmed`;
}

function PreviewWarnings({
  warnings,
}: {
  readonly warnings: readonly string[];
}): React.JSX.Element {
  return (
    <>
      {warnings.map((warning) => (
        <p className="workflow-error" key={warning} role="alert">
          {warning}
        </p>
      ))}
    </>
  );
}

function AlbumTitleWorkbenchComponent(
  {
    albumTitle,
    artworkUndoPreview,
    artworkUndoResult,
    batchUndoKind,
    batchUndoPreview,
    batchUndoResult,
    busy,
    draftTitle,
    editError,
    editHistory,
    editPreview,
    editResult,
    historyError,
    section,
    showNavigation = true,
    trackUndoPreview,
    trackUndoResult,
    undoPreview,
    undoResult,
    onCancelBatchUndo,
    onCancelArtworkUndo,
    onCancelEditPreview,
    onCancelTrackUndo,
    onCancelUndo,
    onConfirmBatchUndo,
    onConfirmArtworkUndo,
    onConfirmEdit,
    onConfirmTrackUndo,
    onConfirmUndo,
    onDraftTitleChange,
    onPreviewBatchUndo,
    onPreviewArtworkUndo,
    onPreviewEdit,
    onPreviewTrackUndo,
    onPreviewUndo,
    onSectionChange,
  }: {
    readonly albumTitle: string;
    readonly artworkUndoPreview: AlbumArtworkEditPreviewDto | undefined;
    readonly artworkUndoResult: TagEditResultDto | undefined;
    readonly batchUndoKind: BatchUndoKind;
    readonly batchUndoPreview: TrackBatchEditPreviewDto | undefined;
    readonly batchUndoResult: TagEditResultDto | undefined;
    readonly busy: boolean;
    readonly draftTitle: string;
    readonly editError: string | undefined;
    readonly editHistory: readonly TagEditHistoryItemDto[];
    readonly editPreview: TagEditPreviewDto | undefined;
    readonly editResult: TagEditResultDto | undefined;
    readonly historyError: string | undefined;
    readonly section: AlbumTitleSection;
    readonly showNavigation?: boolean;
    readonly trackUndoPreview: TrackTagEditPreviewDto | undefined;
    readonly trackUndoResult: TagEditResultDto | undefined;
    readonly undoPreview: TagEditPreviewDto | undefined;
    readonly undoResult: TagEditResultDto | undefined;
    readonly onCancelBatchUndo: () => void;
    readonly onCancelArtworkUndo: () => void;
    readonly onCancelEditPreview: () => void;
    readonly onCancelTrackUndo: () => void;
    readonly onCancelUndo: () => void;
    readonly onConfirmBatchUndo: () => void;
    readonly onConfirmArtworkUndo: () => void;
    readonly onConfirmEdit: () => void;
    readonly onConfirmTrackUndo: () => void;
    readonly onConfirmUndo: () => void;
    readonly onDraftTitleChange: (title: string) => void;
    readonly onPreviewBatchUndo: (
      operationId: string,
      kind: BatchUndoKind,
    ) => void;
    readonly onPreviewArtworkUndo: (operationId: string) => void;
    readonly onPreviewEdit: () => void;
    readonly onPreviewTrackUndo: (operationId: string) => void;
    readonly onPreviewUndo: (operationId: string) => void;
    readonly onSectionChange: (section: AlbumTitleSection) => void;
  },
  ref: Ref<HTMLElement>,
): React.JSX.Element {
  const batchUndoSubject =
    batchUndoKind === "track-order"
      ? "Track-number sequence undo"
      : batchUndoKind === "musicbrainz-mapping"
        ? "MusicBrainz track mapping undo"
        : "Shared-field undo";

  return (
    <section
      className="card album-title-workbench"
      aria-label="Album title editor"
      ref={ref}
      tabIndex={-1}
    >
      {showNavigation && (
        <nav
          aria-label="Album title workspace"
          className="album-title-navigation"
        >
          <button
            aria-current={section === "edit" ? "page" : undefined}
            onClick={() => onSectionChange("edit")}
            type="button"
          >
            <span>Edit title</span>
            <small>Draft, preview, and verify an album-title change.</small>
          </button>
          <button
            aria-current={section === "history" ? "page" : undefined}
            onClick={() => onSectionChange("history")}
            type="button"
          >
            <span>Change history & undo</span>
            <small>Review a past change before restoring earlier values.</small>
          </button>
        </nav>
      )}

      {section === "edit" ? (
        <div className="album-title-section">
          <WorkbenchDraftHeading
            context="Draft"
            title="Edit album title"
            description={
              <>
                Editing <strong>{albumTitle}</strong>. The proposal applies only
                to the album-title field on its current files.
              </>
            }
          />
          <label htmlFor="album-title">Proposed title</label>
          <div className="inline">
            <input
              id="album-title"
              value={draftTitle}
              onChange={(event) => onDraftTitleChange(event.target.value)}
            />
            <button
              className="primary"
              disabled={!draftTitle.trim() || busy}
              onClick={onPreviewEdit}
              type="button"
            >
              Review per-file changes
            </button>
          </div>

          {editError && (
            <div className="workflow-error" role="alert">
              <strong>The album-title request could not be completed.</strong>
              <span>{editError}</span>
            </div>
          )}

          {editPreview && (
            <WorkbenchConfirmation
              blocked={editPreview.files.some(
                (file) => file.warnings.length > 0,
              )}
              busy={busy}
              cancelLabel="Return to title draft"
              confirmLabel={`Confirm and write ${editPreview.files.length} ${editPreview.files.length === 1 ? "file" : "files"}`}
              description="Outgroove will check this proposal again, snapshot the current tags, safely replace each file, then re-read and verify the album title."
              label="Tag edit confirmation"
              title="Review every album-title change"
              onCancel={onCancelEditPreview}
              onConfirm={onConfirmEdit}
            >
              <div className="workbench-file-reviews">
                {editPreview.files.map((file) => (
                  <article key={file.fileId}>
                    <h5>{file.path}</h5>
                    <dl className="change-summary">
                      <div>
                        <dt>Before</dt>
                        <dd>{file.before}</dd>
                      </div>
                      <div>
                        <dt>After</dt>
                        <dd>{file.after}</dd>
                      </div>
                    </dl>
                    <PreviewWarnings warnings={file.warnings} />
                  </article>
                ))}
              </div>
            </WorkbenchConfirmation>
          )}

          {editResult && (
            <WorkbenchWriteResult
              label="Album title result"
              results={editResult.results}
              subject="Album-title write"
            />
          )}
        </div>
      ) : (
        <div className="album-title-section">
          <div className="workflow-heading">
            <div>
              <p className="eyebrow">Past changes</p>
              <h3>Change history & undo</h3>
              <p>
                Review a past change and restore its earlier values. Outgroove
                won’t overwrite a file that has changed since.
              </p>
            </div>
            <span className="safety-badge">Preview before restoring</span>
          </div>

          {historyError && (
            <div className="workflow-error" role="alert">
              <strong>
                Outgroove couldn’t load this album’s change history.
              </strong>
              <span>{historyError}</span>
            </div>
          )}

          <div className="history" aria-label="Metadata edit history">
            {editHistory.length === 0 ? (
              <div className="workflow-empty">
                <h4>No changes to undo</h4>
                <p>
                  Changes you confirm for this album will appear here after
                  Outgroove checks the updated files.
                </p>
              </div>
            ) : (
              <ol>
                {editHistory.map((item) => (
                  <li key={item.operationId}>
                    <div>
                      <strong>{historyLabel(item)}</strong>
                      <span>
                        {historyOutcome(item)} ·{" "}
                        <time dateTime={item.completedAt ?? item.createdAt}>
                          {new Date(
                            item.completedAt ?? item.createdAt,
                          ).toLocaleString()}
                        </time>
                      </span>
                    </div>
                    {item.kind === "album-title-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => onPreviewUndo(item.operationId)}
                          type="button"
                        >
                          Review title restore
                        </button>
                      )}
                    {item.kind === "track-tags-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => onPreviewTrackUndo(item.operationId)}
                          type="button"
                        >
                          Review field restore
                        </button>
                      )}
                    {item.kind === "track-tags-batch-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            onPreviewBatchUndo(
                              item.operationId,
                              item.proposedTitle.startsWith(
                                "MusicBrainz track mapping:",
                              )
                                ? "musicbrainz-mapping"
                                : "shared-fields",
                            )
                          }
                          type="button"
                        >
                          {item.proposedTitle.startsWith(
                            "MusicBrainz track mapping:",
                          )
                            ? "Review mapping restore"
                            : "Review shared-field restore"}
                        </button>
                      )}
                    {item.kind === "track-number-sequence-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            onPreviewBatchUndo(item.operationId, "track-order")
                          }
                          type="button"
                        >
                          Review track-number restore
                        </button>
                      )}
                    {item.kind === "album-artwork-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => onPreviewArtworkUndo(item.operationId)}
                          type="button"
                        >
                          Review artwork restore
                        </button>
                      )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {undoPreview && (
            <WorkbenchConfirmation
              blocked={undoPreview.files.some(
                (file) => file.warnings.length > 0,
              )}
              busy={busy}
              cancelLabel="Keep current titles"
              confirmLabel={`Restore titles in ${undoPreview.files.length} ${undoPreview.files.length === 1 ? "file" : "files"}`}
              description="Outgroove will restore a title only if it still matches the past change. It saves the current tags first, writes the earlier title, then checks the file again."
              label="Tag undo confirmation"
              title="Restore earlier album titles?"
              onCancel={onCancelUndo}
              onConfirm={onConfirmUndo}
            >
              <div className="workbench-file-reviews">
                {undoPreview.files.map((file) => (
                  <article key={file.fileId}>
                    <h5>{file.path}</h5>
                    <dl className="change-summary">
                      <div>
                        <dt>Current</dt>
                        <dd>{file.before}</dd>
                      </div>
                      <div>
                        <dt>Restore</dt>
                        <dd>{file.after}</dd>
                      </div>
                    </dl>
                    <PreviewWarnings warnings={file.warnings} />
                  </article>
                ))}
              </div>
            </WorkbenchConfirmation>
          )}

          {undoResult && (
            <WorkbenchWriteResult
              label="Album title undo result"
              results={undoResult.results}
              subject="Album-title undo"
            />
          )}

          {trackUndoPreview && (
            <WorkbenchConfirmation
              blocked={trackUndoPreview.warnings.length > 0}
              busy={busy}
              cancelLabel="Keep current track fields"
              confirmLabel="Restore earlier track fields"
              description="Only fields from the past change will be restored. If a field has changed since then, Outgroove leaves it alone."
              label="Track metadata undo confirmation"
              title="Restore earlier track details?"
              onCancel={onCancelTrackUndo}
              onConfirm={onConfirmTrackUndo}
            >
              <div className="workbench-file-reviews">
                <article>
                  <h5>{trackUndoPreview.path}</h5>
                  <div className="preview-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Current</th>
                          <th>Restore</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trackUndoPreview.changes.map((change) => (
                          <tr key={change.field}>
                            <td>{change.field}</td>
                            <td>{change.before ?? "Not set"}</td>
                            <td>{change.after ?? "Not set"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PreviewWarnings warnings={trackUndoPreview.warnings} />
                </article>
              </div>
            </WorkbenchConfirmation>
          )}

          {trackUndoResult && (
            <WorkbenchWriteResult
              label="Track metadata undo result"
              results={trackUndoResult.results}
              subject="Track metadata undo"
            />
          )}

          {batchUndoPreview && (
            <WorkbenchConfirmation
              blocked={
                !batchUndoPreview.files.some(
                  (file) => file.willWrite && file.warnings.length === 0,
                )
              }
              busy={busy}
              cancelLabel="Keep current track fields"
              confirmLabel="Restore the available earlier values"
              description="Only values confirmed after the past change are included. Outgroove leaves conflicting files alone while restoring the files that are still safe to change."
              label="Batch metadata undo confirmation"
              title={`Review ${batchUndoSubject.toLowerCase()}`}
              onCancel={onCancelBatchUndo}
              onConfirm={onConfirmBatchUndo}
            >
              <div className="workbench-file-reviews">
                {batchUndoPreview.files.map((file) => (
                  <article key={file.fileId}>
                    <h5>{file.path}</h5>
                    {!file.willWrite && (
                      <p className="review-status">
                        Status: already restored — skipped
                      </p>
                    )}
                    {file.changes.length > 0 && (
                      <div className="preview-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Field</th>
                              <th>Current</th>
                              <th>Restore</th>
                            </tr>
                          </thead>
                          <tbody>
                            {file.changes.map((change) => (
                              <tr key={change.field}>
                                <td>{change.field}</td>
                                <td>{change.before ?? "Not set"}</td>
                                <td>{change.after ?? "Not set"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <PreviewWarnings warnings={file.warnings} />
                  </article>
                ))}
              </div>
            </WorkbenchConfirmation>
          )}

          {artworkUndoPreview && (
            <WorkbenchConfirmation
              blocked={
                artworkUndoPreview.files.filter((file) => file.willWrite)
                  .length === 0
              }
              busy={busy}
              cancelLabel="Keep current artwork"
              confirmLabel={`Restore artwork in ${artworkUndoPreview.files.filter((file) => file.willWrite).length} files`}
              description="Outgroove will restore all embedded pictures saved with the past change. It leaves a file alone if its artwork has changed since."
              label="Artwork undo confirmation"
              title="Restore the earlier artwork?"
              onCancel={onCancelArtworkUndo}
              onConfirm={onConfirmArtworkUndo}
            >
              {artworkUndoPreview.proposedArtworkDataUrl ? (
                <div className="artwork-undo-preview">
                  <img
                    alt="Front cover restored by this undo"
                    src={artworkUndoPreview.proposedArtworkDataUrl}
                  />
                  <p>
                    This is the recorded front cover. Any other recorded
                    embedded pictures are restored as well.
                  </p>
                </div>
              ) : (
                <p>
                  The recorded state has no embedded front cover. Other recorded
                  embedded pictures are still restored exactly.
                </p>
              )}
              <div className="workbench-file-reviews">
                {artworkUndoPreview.files.map((file) => (
                  <article key={file.fileId}>
                    <h5>{file.path}</h5>
                    <p>
                      {file.willWrite
                        ? "Current artwork matches the verified edit and can be restored."
                        : "This file will remain unchanged."}
                    </p>
                    <PreviewWarnings warnings={file.warnings} />
                  </article>
                ))}
              </div>
            </WorkbenchConfirmation>
          )}

          {artworkUndoResult && (
            <WorkbenchWriteResult
              label="Artwork undo result"
              results={artworkUndoResult.results}
              subject="Artwork undo"
            />
          )}

          {batchUndoResult && (
            <WorkbenchWriteResult
              label="Batch metadata undo result"
              results={batchUndoResult.results}
              subject={batchUndoSubject}
            />
          )}
        </div>
      )}
    </section>
  );
}

export const AlbumTitleWorkbench = forwardRef(AlbumTitleWorkbenchComponent);
