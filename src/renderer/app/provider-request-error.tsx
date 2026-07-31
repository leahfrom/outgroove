import { TechnicalDetails } from "./technical-details";

export function ProviderRequestError({
  details,
  detailsSummary = "Technical details",
  guidance,
  label,
  title,
}: {
  readonly details: readonly string[];
  readonly detailsSummary?: string;
  readonly guidance: string;
  readonly label: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <div
      aria-label={label}
      className="workflow-error provider-request-error"
      role="alert"
    >
      <strong>{title}</strong>
      <p>{guidance}</p>
      <TechnicalDetails messages={details} summary={detailsSummary} />
    </div>
  );
}
