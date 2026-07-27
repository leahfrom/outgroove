export type LibraryAlbumEditingTool =
  "title" | "shared" | "sequence" | "artwork" | "history";

const tools: readonly {
  readonly id: LibraryAlbumEditingTool;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: "title",
    label: "Album title",
    description: "Change only the album-title field.",
  },
  {
    id: "shared",
    label: "Shared fields",
    description: "Choose tracks and compare shared tag values.",
  },
  {
    id: "sequence",
    label: "Track order",
    description: "Review explicit track and disc numbering.",
  },
  {
    id: "artwork",
    label: "Artwork",
    description: "Preview a local embedded front-cover change.",
  },
  {
    id: "history",
    label: "History & undo",
    description: "Review verified writes before proposing a restore.",
  },
];

export function LibraryAlbumEditingNavigation({
  activeTool,
  onSelect,
}: {
  readonly activeTool: LibraryAlbumEditingTool;
  readonly onSelect: (tool: LibraryAlbumEditingTool) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Album editing tools" className="album-editing-tools">
      {tools.map((tool) => (
        <button
          aria-label={`${tool.label}. ${tool.description}`}
          aria-current={activeTool === tool.id ? "page" : undefined}
          key={tool.id}
          onClick={() => onSelect(tool.id)}
          type="button"
        >
          <span>{tool.label}</span>
          <small>{tool.description}</small>
        </button>
      ))}
    </nav>
  );
}
