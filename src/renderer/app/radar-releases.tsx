import type {
  RadarItemDto,
  RadarRefreshResultDto,
  radarViews,
} from "../../shared/contracts/api";
import {
  radarPrimaryTypeFilters,
  type RadarPrimaryTypeFilter,
} from "../../shared/domain/radar";

type RadarViewName = (typeof radarViews)[number];

const viewLabels: Record<RadarViewName, string> = {
  all: "All current",
  upcoming: "Upcoming",
  recent: "Recent",
  "newly-found": "Newly found",
};

const emptyViewLabels: Record<RadarViewName, string> = {
  all: "current",
  upcoming: "upcoming",
  recent: "recent",
  "newly-found": "newly found",
};

const reasonLabels = {
  upcoming: "Upcoming",
  recent: "Released in the last 90 days",
  "newly-found": "Newly found in MusicBrainz",
} as const;

const primaryTypeLabels: Record<RadarPrimaryTypeFilter, string> = {
  all: "All types",
  album: "Albums",
  single: "Singles",
  ep: "EPs",
  broadcast: "Broadcasts",
  other: "Other",
  unknown: "Unknown or unsupported",
};

export function RadarReleases({
  actionBusyId,
  error,
  includeDismissed,
  items,
  limit,
  loading,
  offset,
  primaryType,
  refreshResult,
  totalItems,
  view,
  onDismissed,
  onIncludeDismissedChange,
  onOpen,
  onPage,
  onPrimaryTypeChange,
  onSeen,
  onViewChange,
}: {
  readonly actionBusyId: string | undefined;
  readonly error: string | undefined;
  readonly includeDismissed: boolean;
  readonly items: readonly RadarItemDto[];
  readonly limit: number;
  readonly loading: boolean;
  readonly offset: number;
  readonly primaryType: RadarPrimaryTypeFilter;
  readonly refreshResult: RadarRefreshResultDto | undefined;
  readonly totalItems: number;
  readonly view: RadarViewName;
  readonly onDismissed: (item: RadarItemDto, dismissed: boolean) => void;
  readonly onIncludeDismissedChange: (include: boolean) => void;
  readonly onOpen: (item: RadarItemDto) => void;
  readonly onPage: (offset: number) => void;
  readonly onPrimaryTypeChange: (value: RadarPrimaryTypeFilter) => void;
  readonly onSeen: (item: RadarItemDto, seen: boolean) => void;
  readonly onViewChange: (view: RadarViewName) => void;
}): React.JSX.Element {
  const end = Math.min(offset + items.length, totalItems);
  return (
    <section className="radar-releases" aria-labelledby="radar-releases">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Last successful snapshots</p>
          <h2 id="radar-releases">Releases</h2>
          <p>
            Upcoming dates are certainly in the future. Recent means the
            complete known date falls within the last 90 days. Partial dates
            stay partial and are classified conservatively.
          </p>
        </div>
        <div className="radar-filters">
          <label>
            Release type
            <select
              value={primaryType}
              onChange={(event) =>
                onPrimaryTypeChange(
                  event.target.value as RadarPrimaryTypeFilter,
                )
              }
            >
              {radarPrimaryTypeFilters.map((value) => (
                <option key={value} value={value}>
                  {primaryTypeLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="radar-dismissed-toggle">
            <input
              checked={includeDismissed}
              type="checkbox"
              onChange={(event) =>
                onIncludeDismissedChange(event.target.checked)
              }
            />
            Show dismissed
          </label>
        </div>
      </div>

      <div aria-label="Radar release views" className="radar-view-tabs">
        {Object.entries(viewLabels).map(([value, label]) => (
          <button
            aria-pressed={view === value}
            key={value}
            type="button"
            onClick={() => onViewChange(value as RadarViewName)}
          >
            {label}
          </button>
        ))}
      </div>

      {refreshResult && (
        <p className="identification-status" role="status">
          Refreshed {refreshResult.favoriteArtistName}: {refreshResult.added}{" "}
          new, {refreshResult.updated} changed, {refreshResult.unchanged}{" "}
          unchanged.
          {refreshResult.truncated &&
            " MusicBrainz reported more than the bounded 500-release review window."}
        </p>
      )}
      {loading && <p aria-live="polite">Loading saved Radar releases…</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!loading && items.length === 0 ? (
        <div className="empty compact">
          <h3>No {emptyViewLabels[view]} releases</h3>
          <p>
            Refresh a favorite artist explicitly. Failed or cancelled refreshes
            keep the last successful view unchanged.
          </p>
        </div>
      ) : (
        <ol aria-label={`${viewLabels[view]} Radar releases`}>
          {items.map((item) => (
            <li key={item.id}>
              <article className={item.dismissedAt ? "is-dismissed" : ""}>
                <header>
                  <div>
                    <p className="eyebrow">{item.favoriteArtistName}</p>
                    <h3>{item.title}</h3>
                  </div>
                  <span>{item.seenAt ? "Seen" : "Unseen"}</span>
                </header>
                <div className="radar-reason-list">
                  {item.reasons.length === 0 ? (
                    <span>Current discography</span>
                  ) : (
                    item.reasons.map((reason) => (
                      <span key={reason}>{reasonLabels[reason]}</span>
                    ))
                  )}
                </div>
                <dl>
                  <div>
                    <dt>Release date</dt>
                    <dd>{item.firstReleaseDate ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {[item.primaryType, ...item.secondaryTypes]
                        .filter(Boolean)
                        .join(" · ") || "Unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt>Status / country</dt>
                    <dd>
                      {[item.status, item.country]
                        .filter(Boolean)
                        .join(" · ") || "Unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt>Stable release-group ID</dt>
                    <dd>
                      <code>{item.musicBrainzReleaseGroupId}</code>
                    </dd>
                  </div>
                </dl>
                <div className="actions">
                  <button
                    disabled={actionBusyId === item.id}
                    type="button"
                    onClick={() => onSeen(item, !item.seenAt)}
                  >
                    {item.seenAt ? "Mark unseen" : "Mark seen"}
                  </button>
                  <button
                    disabled={actionBusyId === item.id}
                    type="button"
                    onClick={() => onDismissed(item, !item.dismissedAt)}
                  >
                    {item.dismissedAt ? "Restore item" : "Dismiss item"}
                  </button>
                  <button
                    aria-label={`Open ${item.title} in MusicBrainz`}
                    className="secondary"
                    disabled={actionBusyId === item.id}
                    type="button"
                    onClick={() => onOpen(item)}
                  >
                    Open in MusicBrainz
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}

      {totalItems > 0 && (
        <nav aria-label="Radar release pages" className="pagination">
          <button
            disabled={offset === 0}
            type="button"
            onClick={() => onPage(Math.max(0, offset - limit))}
          >
            Previous page
          </button>
          <span>
            {offset + 1}–{end} of {totalItems}
          </span>
          <button
            disabled={offset + limit >= totalItems}
            type="button"
            onClick={() => onPage(offset + limit)}
          >
            Next page
          </button>
        </nav>
      )}
    </section>
  );
}
