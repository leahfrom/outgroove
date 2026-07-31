import { useEffect, useRef, type ReactNode } from "react";

import { TechnicalDetails } from "./technical-details";

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

export function WorkbenchRequestError({
  label,
  message,
  recovery,
}: {
  readonly label: string;
  readonly message: string;
  readonly recovery: string;
}): React.JSX.Element {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    errorRef.current?.focus();
  }, [message]);

  return (
    <div
      aria-label={label}
      className="workflow-error"
      ref={errorRef}
      role="alert"
      tabIndex={-1}
    >
      <strong>Outgroove couldn’t complete this step.</strong>
      <span>{recovery}</span>
      <TechnicalDetails messages={[message]} />
    </div>
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
          <strong>These changes can’t be confirmed yet.</strong>
          <span>
            Check the warnings below. Then return to the draft and create a new
            preview.
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
          ? `${subject} complete`
          : `${verified} confirmed; ${failed} couldn’t be confirmed`}
      </h4>
      <p>
        {failed === 0
          ? `Outgroove checked ${verified === 1 ? "the file" : `all ${verified} files`} after writing and confirmed the requested changes.`
          : "Outgroove checked each file after writing. Review any file it couldn’t confirm before trying again."}
      </p>
      <ul className="workflow-result-list">
        {results.map((result) => (
          <li key={result.fileId}>
            <strong>{result.path}</strong>
            <span>
              {result.verified ? "Change confirmed" : "Check this file"}
            </span>
            {result.error && (
              <TechnicalDetails
                messages={[result.error]}
                summary="Why Outgroove couldn’t confirm this file"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
