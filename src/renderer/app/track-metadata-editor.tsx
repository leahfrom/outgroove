import {
  forwardRef,
  useEffect,
  useRef,
  type ChangeEvent,
  type Ref,
} from "react";

import type {
  TagEditResultDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";

export interface TrackMetadataDraft {
  title: string;
  artist: string;
  albumArtist: string;
  trackNumber: string;
  discNumber: string;
  year: string;
}

interface TrackMetadataEditorProps {
  track: CatalogAlbum["tracks"][number];
  draft: TrackMetadataDraft;
  preview: TrackTagEditPreviewDto | undefined;
  result: TagEditResultDto | undefined;
  error: string | undefined;
  busy: boolean;
  onDraftChange: (field: keyof TrackMetadataDraft, value: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onCancelPreview: () => void;
  onClose: () => void;
}

function TrackMetadataEditorComponent(
  {
    track,
    draft,
    preview,
    result,
    error,
    busy,
    onDraftChange,
    onPreview,
    onConfirm,
    onCancelPreview,
    onClose,
  }: TrackMetadataEditorProps,
  ref: Ref<HTMLElement>,
) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const written = result?.results[0];

  useEffect(() => {
    if (preview) confirmRef.current?.focus();
  }, [preview]);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const change =
    (field: keyof TrackMetadataDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      onDraftChange(field, event.target.value);
    };

  return (
    <section
      className="card track-editor"
      aria-label="Track metadata editor"
      ref={ref}
      tabIndex={-1}
    >
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Step 1 · Draft</p>
          <h3>Edit track metadata</h3>
          <p>
            Editing <strong>{track.tags.title}</strong>
            {track.tags.artist ? ` by ${track.tags.artist}` : ""}. Only fields
            that differ will be proposed.
          </p>
        </div>
        <span className="safety-badge">Source file unchanged</span>
      </div>

      <div className="safety-note">
        <strong>Preview required</strong>
        <span>
          Drafting does not touch the file. You will review every exact change
          before confirmation.
        </span>
      </div>

      <fieldset>
        <legend>Identity</legend>
        <div className="field-grid">
          <label>
            Track title
            <input value={draft.title} onChange={change("title")} />
          </label>
          <label>
            Track artist
            <input value={draft.artist} onChange={change("artist")} />
          </label>
          <label>
            Album artist
            <input value={draft.albumArtist} onChange={change("albumArtist")} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Sequence and release</legend>
        <div className="field-grid">
          <label>
            Track number
            <input
              type="number"
              min="1"
              max="9999"
              value={draft.trackNumber}
              onChange={change("trackNumber")}
            />
          </label>
          <label>
            Disc number
            <input
              type="number"
              min="1"
              max="999"
              value={draft.discNumber}
              onChange={change("discNumber")}
            />
          </label>
          <label>
            Release date
            <input
              placeholder="YYYY, YYYY-MM, or YYYY-MM-DD"
              value={draft.year}
              onChange={change("year")}
            />
          </label>
        </div>
      </fieldset>

      <div className="actions">
        <button className="primary" disabled={busy} onClick={onPreview}>
          Review exact changes
        </button>
        <button disabled={busy} onClick={onClose}>
          Close editor
        </button>
      </div>

      {error && (
        <div className="workflow-error" role="alert">
          <strong>The request could not be completed.</strong>
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <section
          className="preview confirmation-panel"
          aria-label="Track metadata confirmation"
        >
          <div className="workflow-heading">
            <div>
              <p className="eyebrow">Step 2 · Confirmation</p>
              <h4>Review exact changes</h4>
              <p>
                This proposal will be checked again immediately before the safe
                write.
              </p>
            </div>
            <span className="safety-badge">No file changed yet</span>
          </div>
          <div className="preview-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((item) => (
                  <tr key={item.field}>
                    <td>{item.field}</td>
                    <td>{item.before ?? "Not set"}</td>
                    <td>{item.after ?? "Not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.warnings.map((warning) => (
            <p className="workflow-error" key={warning} role="alert">
              {warning}
            </p>
          ))}
          <div className="actions">
            <button
              className="primary"
              ref={confirmRef}
              disabled={busy || preview.warnings.length > 0}
              onClick={onConfirm}
            >
              Confirm and write track
            </button>
            <button disabled={busy} onClick={onCancelPreview}>
              Return to draft
            </button>
          </div>
        </section>
      )}

      {written && (
        <div
          className={`workflow-result ${written.verified ? "verified" : "failed"}`}
          aria-label="Track metadata result"
          ref={resultRef}
          role={written.verified ? "status" : "alert"}
          tabIndex={-1}
        >
          <p className="eyebrow">Step 3 · Result</p>
          <h4>
            {written.verified
              ? "Write re-read and verified"
              : "Track was not changed"}
          </h4>
          <p>
            {written.verified
              ? "Outgroove re-read the file and confirmed the requested metadata."
              : (written.error ??
                "The safe write or its verification did not complete.")}
          </p>
          {!written.verified && (
            <p>
              The exact preview remains available above so you can review it or
              return to the draft.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export const TrackMetadataEditor = forwardRef(TrackMetadataEditorComponent);
