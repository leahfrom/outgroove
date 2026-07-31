export function TechnicalDetails({
  messages,
  summary = "Technical details",
}: {
  readonly messages: readonly string[];
  readonly summary?: string;
}): React.JSX.Element | null {
  const details = [
    ...new Set(messages.map((message) => message.trim())),
  ].filter(Boolean);

  if (details.length === 0) return null;

  return (
    <details className="technical-details">
      <summary>{summary}</summary>
      {details.length === 1 ? (
        <p>{details[0]}</p>
      ) : (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
