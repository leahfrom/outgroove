export type SyncStage = "setup" | "review" | "recovery";

const stages: readonly {
  id: SyncStage;
  label: string;
  description: string;
}[] = [
  {
    id: "setup",
    label: "Albums & profiles",
    description: "Choose albums and manage saved DAP profiles.",
  },
  {
    id: "review",
    label: "Preview & apply",
    description: "Review the deterministic copy plan before applying it.",
  },
  {
    id: "recovery",
    label: "Recovery",
    description: "Review interrupted target changes before recovery.",
  },
];

export function SyncNavigation({
  activeStage,
  hasActiveProfile,
  recoveryCount,
  onSelect,
}: {
  readonly activeStage: SyncStage;
  readonly hasActiveProfile: boolean;
  readonly recoveryCount: number;
  readonly onSelect: (stage: SyncStage) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Sync workflow" className="sync-navigation">
      {stages.map((stage, index) => {
        const disabled = stage.id === "review" && !hasActiveProfile;
        return (
          <button
            aria-label={`${stage.label}${stage.id === "recovery" && recoveryCount > 0 ? `, ${recoveryCount} pending` : ""}`}
            aria-current={activeStage === stage.id ? "step" : undefined}
            disabled={disabled}
            key={stage.id}
            onClick={() => onSelect(stage.id)}
            type="button"
          >
            <span>
              {index + 1}. {stage.label}
              {stage.id === "recovery" && recoveryCount > 0
                ? ` (${recoveryCount})`
                : ""}
            </span>
            <small>{stage.description}</small>
          </button>
        );
      })}
    </nav>
  );
}
