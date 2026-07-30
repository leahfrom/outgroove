export type SettingsSection = "library-folders" | "database";

const sections: readonly {
  id: SettingsSection;
  label: string;
  description: string;
}[] = [
  {
    id: "library-folders",
    label: "Library folders",
    description: "Manage watched roots and their scan state.",
  },
  {
    id: "database",
    label: "Database safety",
    description: "Back up, restore, or export support diagnostics.",
  },
];

export function SettingsNavigation({
  activeSection,
  hasRestorePreview,
  onSelect,
}: {
  readonly activeSection: SettingsSection;
  readonly hasRestorePreview: boolean;
  readonly onSelect: (section: SettingsSection) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Settings sections" className="settings-navigation">
      {sections.map((section) => (
        <button
          aria-label={`${section.label}${section.id === "database" && hasRestorePreview ? ", confirmation pending" : ""}`}
          aria-current={activeSection === section.id ? "page" : undefined}
          key={section.id}
          onClick={() => onSelect(section.id)}
          type="button"
        >
          <span>{section.label}</span>
          <small>{section.description}</small>
        </button>
      ))}
    </nav>
  );
}
