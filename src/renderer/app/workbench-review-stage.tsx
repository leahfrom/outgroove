import { useEffect, useRef, type ReactNode } from "react";

interface WriteResultItem {
  readonly fileId: string;
  readonly path: string;
  readonly verified: boolean;
  readonly error: string | null;
}

export function WorkbenchDraftHeading({
  context,
  title,
  description,
}: {
  readonly context: string;
  readonly title: string;
  readonly description: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Step 1 · {context}</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="safety-badge">Source files unchanged</span>
      </div>
      <div className="safety-note">
        <strong>Preview required</strong>
        <span>
          Changes remain a draft until you review the exact per-file proposal
          and explicitly confirm it.
        </span>
      </div>
    </>
  );
}

export function WorkbenchConfirmation({
  label,
  title,
  description,
  blocked,
  busy,
  confirmLabel,
  cancelLabel,
  children,
  onConfirm,
  onCancel,
}: {
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly blocked: boolean;
  readonly busy: boolean;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly children: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (blocked) panelRef.current?.focus();
    else confirmRef.current?.focus();
  }, [blocked]);

  return (
    <section
      className="preview confirmation-panel"
      aria-label={label}
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Step 2 · Confirmation</p>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <span className="safety-badge">No file changed yet</span>
      </div>
      {children}
      {blocked && (
        <div className="workflow-error" role="alert">
          <strong>Confirmation is blocked.</strong>
          <span>
            Review the per-file warnings, return to the draft, and create a
            fresh preview before writing.
          </span>
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          ref={confirmRef}
          disabled={busy || blocked}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
        <button disabled={busy} onClick={onCancel} type="button">
          {cancelLabel}
        </button>
      </div>
    </section>
  );
}

export function WorkbenchWriteResult({
  label,
  subject,
  results,
}: {
  readonly label: string;
  readonly subject: string;
  readonly results: readonly WriteResultItem[];
}): React.JSX.Element {
  const resultRef = useRef<HTMLDivElement>(null);
  const verified = results.filter((result) => result.verified).length;
  const failed = results.length - verified;

  useEffect(() => {
    resultRef.current?.focus();
  }, []);

  return (
    <div
      className={`workflow-result ${failed > 0 ? "failed" : "verified"}`}
      aria-label={label}
      ref={resultRef}
      role={failed > 0 ? "alert" : "status"}
      tabIndex={-1}
    >
      <p className="eyebrow">Step 3 · Result</p>
      <h4>
        {failed === 0
          ? `${subject} re-read and verified`
          : `${verified} verified; ${failed} need attention`}
      </h4>
      <p>
        {failed === 0
          ? `Outgroove re-read all ${verified} written ${verified === 1 ? "file" : "files"} and verified the requested metadata.`
          : "Verified files completed safely. A failed item is never reported as verified; review its error before creating a fresh preview."}
      </p>
      <ul className="workflow-result-list">
        {results.map((result) => (
          <li key={result.fileId}>
            <strong>{result.path}</strong>
            <span>{result.verified ? "Verified" : "Needs attention"}</span>
            {result.error && <span>{result.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
