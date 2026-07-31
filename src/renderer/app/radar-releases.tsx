import type {
  FavoriteArtistDto,
  RadarItemDto,
  RadarReviewSummaryDto,
  RadarRefreshResultDto,
  radarViews,
} from "../../shared/contracts/api";
import {
  radarPrimaryTypeFilters,
  type RadarPrimaryTypeFilter,
} from "../../shared/domain/radar";
import { ProviderRequestError } from "./provider-request-error";

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
  favoriteArtistId,
  favorites,
  includeDismissed,
  items,
  limit,
  loading,
  offset,
  primaryType,
  refreshResult,
  summary,
  totalItems,
  unseenOnly,
  view,
  onDismissed,
  onFavoriteArtistChange,
  onIncludeDismissedChange,
  onOpen,
  onPage,
  onPrimaryTypeChange,
  onSeen,
  onUnseenOnlyChange,
  onViewChange,
}: {
  readonly actionBusyId: string | undefined;
  readonly error: string | undefined;
  readonly favoriteArtistId: string | null;
  readonly favorites: readonly FavoriteArtistDto[];
  readonly includeDismissed: boolean;
  readonly items: readonly RadarItemDto[];
  readonly limit: number;
  readonly loading: boolean;
  readonly offset: number;
  readonly primaryType: RadarPrimaryTypeFilter;
  readonly refreshResult: RadarRefreshResultDto | undefined;
  readonly summary: RadarReviewSummaryDto;
  readonly totalItems: number;
  readonly unseenOnly: boolean;
  readonly view: RadarViewName;
  readonly onDismissed: (item: RadarItemDto, dismissed: boolean) => void;
  readonly onFavoriteArtistChange: (id: string | null) => void;
  readonly onIncludeDismissedChange: (include: boolean) => void;
  readonly onOpen: (item: RadarItemDto) => void;
  readonly onPage: (offset: number) => void;
  readonly onPrimaryTypeChange: (value: RadarPrimaryTypeFilter) => void;
  readonly onSeen: (item: RadarItemDto, seen: boolean) => void;
  readonly onUnseenOnlyChange: (unseenOnly: boolean) => void;
  readonly onViewChange: (view: RadarViewName) => void;
}): React.JSX.Element {
  const end = Math.min(offset + items.length, totalItems);
  return (
    <section className="radar-releases" aria-labelledby="radar-releases">
      <div className="section-heading">
        <div>
          <p className="eyebrow">From your latest checks</p>
          <h2 id="radar-releases">Releases</h2>
          <p>
            Upcoming releases have a known future date. Recent releases are from
            the last 90 days. When MusicBrainz has only a year or month, Radar
            keeps that date incomplete instead of guessing.
          </p>
        </div>
        <div className="radar-filters">
          <label>
            Favorite artist
            <select
              value={favoriteArtistId ?? ""}
              onChange={(event) =>
                onFavoriteArtistChange(event.target.value || null)
              }
            >
              <option value="">All favorite artists</option>
              {favorites.map((favorite) => (
                <option key={favorite.id} value={favorite.id}>
                  {favorite.name} — {favorite.unseenRadarCount} unseen
                </option>
              ))}
            </select>
          </label>
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
              checked={unseenOnly}
              type="checkbox"
              onChange={(event) => onUnseenOnlyChange(event.target.checked)}
            />
            Unseen only
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

      <dl aria-label="Radar review summary" className="radar-review-summary">
        <div>
          <dt>Current</dt>
          <dd>{summary.current}</dd>
        </div>
        <div>
          <dt>Unseen</dt>
          <dd>{summary.unseen}</dd>
        </div>
        <div>
          <dt>Upcoming</dt>
          <dd>{summary.upcoming}</dd>
        </div>
        <div>
          <dt>Recent</dt>
          <dd>{summary.recent}</dd>
        </div>
        <div>
          <dt>Newly found</dt>
          <dd>{summary.newlyFound}</dd>
        </div>
      </dl>

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
            " MusicBrainz returned more than 500 releases, so Radar showed the first 500."}
        </p>
      )}
      {loading && <p aria-live="polite">Loading saved Radar releases…</p>}
      {error && (
        <ProviderRequestError
          details={[error]}
          guidance="Your saved Radar releases are still available. Review the details, then retry the action. If it needs MusicBrainz, check your connection first."
          label="Radar request error"
          title="Radar couldn’t complete this action."
        />
      )}

      {!loading && items.length === 0 ? (
        <div className="empty compact">
          <h3>No {emptyViewLabels[view]} releases</h3>
          <p>
            Refresh a favorite artist to check again. If a refresh fails or is
            cancelled, your previous results stay here.
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
                    <dt>MusicBrainz release group ID</dt>
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
