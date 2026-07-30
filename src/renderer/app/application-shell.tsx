import type { ReactNode } from "react";

export const appViews = [
  "library",
  "radar",
  "sync",
  "activity",
  "settings",
] as const;

export type AppView = (typeof appViews)[number];
export type NoticeTone = "info" | "success" | "error";

export interface AppNotice {
  readonly message: string;
  readonly tone: NoticeTone;
}

const viewCopy: Record<
  AppView,
  { readonly label: string; readonly description: string }
> = {
  library: {
    label: "Library",
    description: "Browse, search, and inspect your local collection.",
  },
  radar: {
    label: "Radar",
    description: "Save exact artist identities for release discovery.",
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
    description: "Manage Library folders, database safety, and diagnostics.",
  },
};

export function ApplicationShell({
  activeView,
  inspectionSessionId,
  notice,
  onDismissNotice,
  onNavigate,
  children,
}: {
  readonly activeView: AppView;
  readonly inspectionSessionId?: string;
  readonly notice: AppNotice | undefined;
  readonly onDismissNotice: () => void;
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
        {inspectionSessionId && (
          <div
            aria-label="Isolated packaged inspection profile"
            className="inspection-banner"
            role="status"
          >
            <strong>
              <span aria-hidden="true" className="inspection-banner-dot" />
              Isolated inspection profile
            </strong>
            <span className="inspection-banner-details">
              <span>Disposable fixture data only</span>
              <span className="inspection-banner-session">
                Session <code>{inspectionSessionId.slice(0, 8)}</code>
              </span>
            </span>
          </div>
        )}
        <header className="view-header">
          <div>
            <p className="eyebrow">Outgroove workspace</p>
            <h1>{current.label}</h1>
            <p>{current.description}</p>
          </div>
        </header>
        {notice && (
          <div
            aria-atomic="true"
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
            className={`notice ${notice.tone}`}
            role="status"
          >
            <p>
              <strong className="notice-label">
                {notice.tone === "error"
                  ? "Needs attention"
                  : notice.tone === "success"
                    ? "Completed"
                    : "Update"}
              </strong>
              <span>{notice.message}</span>
            </p>
            <button
              aria-label="Dismiss notification"
              onClick={onDismissNotice}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
