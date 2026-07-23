export type WorkbenchTool = "overview" | "album" | "track" | "batch";

const tools: readonly {
  readonly id: Exclude<WorkbenchTool, "track">;
  readonly label: string;
}[] = [
  { id: "overview", label: "Album overview" },
  { id: "album", label: "Album title" },
  { id: "batch", label: "Batch and sequencing" },
];

export function WorkbenchNavigation({
  activeTool,
  selectedTrackTitle,
  onSelect,
}: {
  readonly activeTool: WorkbenchTool;
  readonly selectedTrackTitle: string | undefined;
  readonly onSelect: (tool: WorkbenchTool) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Workbench tools" className="workbench-tools">
      {tools.map((tool) => (
        <button
          aria-current={activeTool === tool.id ? "page" : undefined}
          key={tool.id}
          onClick={() => onSelect(tool.id)}
          type="button"
        >
          {tool.label}
        </button>
      ))}
      {selectedTrackTitle && (
        <button
          aria-current={activeTool === "track" ? "page" : undefined}
          onClick={() => onSelect("track")}
          type="button"
        >
          Track: {selectedTrackTitle}
        </button>
      )}
    </nav>
  );
}
