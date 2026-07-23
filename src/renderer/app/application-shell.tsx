import type { ReactNode } from "react";

export const appViews = [
  "library",
  "workbench",
  "sync",
  "activity",
  "settings",
] as const;

export type AppView = (typeof appViews)[number];

const viewCopy: Record<
  AppView,
  { readonly label: string; readonly description: string }
> = {
  library: {
    label: "Library",
    description: "Browse, search, and inspect your local collection.",
  },
  workbench: {
    label: "Workbench",
    description: "Review and safely apply metadata changes.",
  },
  sync: {
    label: "Sync",
    description: "Prepare and review folder-backed DAP copies.",
  },
  activity: {
    label: "Activity",
    description: "Follow long-running work, failures, and recovery.",
  },
  settings: {
    label: "Settings",
    description: "Manage Library folders and database safety.",
  },
};

export function ApplicationShell({
  activeView,
  notice,
  onNavigate,
  children,
}: {
  readonly activeView: AppView;
  readonly notice: string;
  readonly onNavigate: (view: AppView) => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  const current = viewCopy[activeView];
  return (
    <div className="application-shell">
      <aside className="primary-sidebar">
        <div className="brand">
          <p className="eyebrow">Local-first music library</p>
          <p className="brand-name">Outgroove</p>
        </div>
        <nav aria-label="Primary navigation" className="primary-navigation">
          {appViews.map((view) => (
            <button
              aria-label={viewCopy[view].label}
              aria-current={activeView === view ? "page" : undefined}
              className={activeView === view ? "active" : undefined}
              key={view}
              onClick={() => onNavigate(view)}
              type="button"
            >
              <span>{viewCopy[view].label}</span>
              <small>{viewCopy[view].description}</small>
            </button>
          ))}
        </nav>
        <p className="privacy-note">
          Audio stays local. Every write and sync requires a review.
        </p>
      </aside>
      <div className="application-surface">
        <header className="view-header">
          <div>
            <p className="eyebrow">Outgroove workspace</p>
            <h1>{current.label}</h1>
            <p>{current.description}</p>
          </div>
        </header>
        <p className="notice" role="status">
          {notice}
        </p>
        {children}
      </div>
    </div>
  );
}
