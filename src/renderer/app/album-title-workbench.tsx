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
export type BatchUndoKind = "shared-fields" | "track-order";

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
            <span>History & undo</span>
            <small>
              Review verified operations before proposing a restore.
            </small>
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
              <p className="eyebrow">Verified operations</p>
              <h3>History & undo</h3>
              <p>
                Undo is a new reviewed metadata write. It restores only recorded
                fields and refuses conflicting external changes.
              </p>
            </div>
            <span className="safety-badge">Undo requires preview</span>
          </div>

          {historyError && (
            <div className="workflow-error" role="alert">
              <strong>The history request could not be completed.</strong>
              <span>{historyError}</span>
            </div>
          )}

          <div className="history" aria-label="Metadata edit history">
            {editHistory.length === 0 ? (
              <div className="workflow-empty">
                <h4>No confirmed edits yet</h4>
                <p>
                  Verified album, track, batch, and sequencing operations for
                  this album will appear here.
                </p>
              </div>
            ) : (
              <ol>
                {editHistory.map((item) => (
                  <li key={item.operationId}>
                    <div>
                      <strong>{historyLabel(item)}</strong>
                      <span>
                        {item.state}; {item.verifiedFiles} verified
                        {item.failedFiles > 0
                          ? `, ${item.failedFiles} failed`
                          : ""}{" "}
                        ·{" "}
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
                          Preview undo
                        </button>
                      )}
                    {item.kind === "track-tags-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => onPreviewTrackUndo(item.operationId)}
                          type="button"
                        >
                          Preview track undo
                        </button>
                      )}
                    {item.kind === "track-tags-batch-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            onPreviewBatchUndo(
                              item.operationId,
                              "shared-fields",
                            )
                          }
                          type="button"
                        >
                          Preview batch undo
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
                          Preview sequence undo
                        </button>
                      )}
                    {item.kind === "album-artwork-edit" &&
                      item.verifiedFiles > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => onPreviewArtworkUndo(item.operationId)}
                          type="button"
                        >
                          Preview artwork undo
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
              confirmLabel={`Confirm and undo ${undoPreview.files.length} ${undoPreview.files.length === 1 ? "file" : "files"}`}
              description="Undo proceeds only when each current album title still matches the verified edit. Every accepted file is snapshotted, safely written, re-read, and verified again."
              label="Tag undo confirmation"
              title="Review album-title restore"
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
              confirmLabel="Confirm and undo track fields"
              description="Only fields recorded by the original edit will be restored. A field changed afterward is refused rather than overwritten."
              label="Track metadata undo confirmation"
              title="Review track-field restore"
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
              confirmLabel="Confirm safe batch undo writes"
              description="Only verified fields from the original operation are proposed. Conflicted files are refused without stopping safe restores on other files."
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
              confirmLabel={`Confirm and restore ${artworkUndoPreview.files.filter((file) => file.willWrite).length} files`}
              description="Undo restores the complete embedded picture set recorded for each verified file. Files whose artwork changed afterward are refused."
              label="Artwork undo confirmation"
              title="Review embedded artwork restore"
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
