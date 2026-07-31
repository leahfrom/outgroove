import type {
  FavoriteArtistDto,
  FavoriteArtistSearchResultDto,
  RadarBackgroundRefreshSettingsDto,
  RadarItemDto,
  RadarNotificationUnavailableReason,
  RadarReviewSummaryDto,
  RadarRefreshAllResultDto,
  RadarRefreshResultDto,
  radarViews,
} from "../../shared/contracts/api";
import type { RadarPrimaryTypeFilter } from "../../shared/domain/radar";
import { ModalSheet } from "./modal-sheet";
import { RadarReleases } from "./radar-releases";

type RadarReleaseView = (typeof radarViews)[number];

export function RadarView({
  artistSearchError,
  artistSearchLoading,
  artistSearchResult,
  artistSearchText,
  favoriteFilter,
  favoriteFilterText,
  favoriteArtistIds,
  favorites,
  mutationBusy,
  radarActionBusyId,
  radarBackgroundBusy,
  radarBackgroundError,
  radarBackgroundSettings,
  radarError,
  radarFavoriteArtistId,
  radarFilterFavorites,
  radarIncludeDismissed,
  radarItems,
  radarLimit,
  radarLoading,
  radarOffset,
  radarPrimaryType,
  radarRefreshResult,
  radarRefreshAllActive,
  radarRefreshAllCancelling,
  radarRefreshAllResult,
  radarSummary,
  radarTotalItems,
  radarUnseenOnly,
  radarView,
  refreshingFavoriteId,
  removal,
  onAdd,
  onArtistSearchTextChange,
  onCancelArtistSearch,
  onCancelRemoval,
  onClearFavoriteFilter,
  onConfirmRemoval,
  onFavoriteFilterTextChange,
  onFilterFavorites,
  onRadarDismissed,
  onRadarFavoriteArtistChange,
  onRadarIncludeDismissedChange,
  onRadarOpen,
  onRadarPage,
  onRadarPrimaryTypeChange,
  onRadarSeen,
  onRadarUnseenOnlyChange,
  onRadarViewChange,
  onRadarBackgroundChange,
  onRefreshAll,
  onRefreshFavorite,
  onCancelRefreshAll,
  onCancelRefresh,
  onRemove,
  onSearchArtists,
}: {
  readonly artistSearchError: string | undefined;
  readonly artistSearchLoading: boolean;
  readonly artistSearchResult: FavoriteArtistSearchResultDto | undefined;
  readonly artistSearchText: string;
  readonly favoriteFilter: string;
  readonly favoriteFilterText: string;
  readonly favoriteArtistIds: readonly string[];
  readonly favorites: readonly FavoriteArtistDto[];
  readonly mutationBusy: boolean;
  readonly radarActionBusyId: string | undefined;
  readonly radarBackgroundBusy: boolean;
  readonly radarBackgroundError: string | undefined;
  readonly radarBackgroundSettings:
    RadarBackgroundRefreshSettingsDto | undefined;
  readonly radarError: string | undefined;
  readonly radarFavoriteArtistId: string | null;
  readonly radarFilterFavorites: readonly FavoriteArtistDto[];
  readonly radarIncludeDismissed: boolean;
  readonly radarItems: readonly RadarItemDto[];
  readonly radarLimit: number;
  readonly radarLoading: boolean;
  readonly radarOffset: number;
  readonly radarPrimaryType: RadarPrimaryTypeFilter;
  readonly radarRefreshResult: RadarRefreshResultDto | undefined;
  readonly radarRefreshAllActive: boolean;
  readonly radarRefreshAllCancelling: boolean;
  readonly radarRefreshAllResult: RadarRefreshAllResultDto | undefined;
  readonly radarSummary: RadarReviewSummaryDto;
  readonly radarTotalItems: number;
  readonly radarUnseenOnly: boolean;
  readonly radarView: RadarReleaseView;
  readonly refreshingFavoriteId: string | undefined;
  readonly removal: FavoriteArtistDto | undefined;
  readonly onAdd: (artistId: string) => void;
  readonly onArtistSearchTextChange: (value: string) => void;
  readonly onCancelArtistSearch: () => void;
  readonly onCancelRemoval: () => void;
  readonly onClearFavoriteFilter: () => void;
  readonly onConfirmRemoval: () => void;
  readonly onFavoriteFilterTextChange: (value: string) => void;
  readonly onFilterFavorites: () => void;
  readonly onRadarDismissed: (item: RadarItemDto, dismissed: boolean) => void;
  readonly onRadarFavoriteArtistChange: (id: string | null) => void;
  readonly onRadarIncludeDismissedChange: (include: boolean) => void;
  readonly onRadarOpen: (item: RadarItemDto) => void;
  readonly onRadarPage: (offset: number) => void;
  readonly onRadarPrimaryTypeChange: (value: RadarPrimaryTypeFilter) => void;
  readonly onRadarSeen: (item: RadarItemDto, seen: boolean) => void;
  readonly onRadarUnseenOnlyChange: (unseenOnly: boolean) => void;
  readonly onRadarViewChange: (view: RadarReleaseView) => void;
  readonly onRadarBackgroundChange: (
    enabled: boolean,
    pauseOnBattery: boolean,
    notificationsEnabled: boolean,
  ) => void;
  readonly onRefreshAll: () => void;
  readonly onRefreshFavorite: (favorite: FavoriteArtistDto) => void;
  readonly onCancelRefreshAll: () => void;
  readonly onCancelRefresh: (favorite: FavoriteArtistDto) => void;
  readonly onRemove: (favorite: FavoriteArtistDto) => void;
  readonly onSearchArtists: () => void;
}): React.JSX.Element {
  const favoriteIds = new Set(favoriteArtistIds);
  return (
    <main className="radar-view">
      <section className="radar-introduction">
        <div>
          <p className="eyebrow">Follow new music</p>
          <h2>Artists you care about</h2>
          <p>
            Follow your favorite artists and see what they have released. Check
            one artist or refresh everyone whenever you like.
          </p>
        </div>
        <div className="radar-introduction-actions">
          <strong>
            {favorites.length === 0
              ? "No artists yet"
              : `${favorites.length} ${favorites.length === 1 ? "artist" : "artists"} shown`}
          </strong>
          {radarRefreshAllActive ? (
            <button
              disabled={radarRefreshAllCancelling}
              type="button"
              onClick={onCancelRefreshAll}
            >
              {radarRefreshAllCancelling
                ? "Stopping refresh all…"
                : "Cancel refresh all"}
            </button>
          ) : (
            <button
              disabled={
                favoriteArtistIds.length === 0 || Boolean(refreshingFavoriteId)
              }
              type="button"
              onClick={onRefreshAll}
            >
              Refresh all favorites
            </button>
          )}
        </div>
      </section>

      <details className="radar-background-settings">
        <summary>Automatic refresh</summary>
        <div>
          <p>
            When enabled, Outgroove checks once a day at a varied time while the
            app is open. It sends only the saved MusicBrainz IDs for your
            favorite artists. It never reads or changes audio files.
            Notifications are optional and show counts only.
          </p>
          {radarBackgroundSettings ? (
            <>
              <fieldset disabled={radarBackgroundBusy}>
                <legend className="visually-hidden">
                  Automatic Radar refresh settings
                </legend>
                <label>
                  <input
                    checked={radarBackgroundSettings.enabled}
                    type="checkbox"
                    onChange={(event) =>
                      onRadarBackgroundChange(
                        event.target.checked,
                        radarBackgroundSettings.pauseOnBattery,
                        radarBackgroundSettings.notificationsEnabled,
                      )
                    }
                  />
                  Check favorite artists automatically
                </label>
                <label>
                  <input
                    checked={radarBackgroundSettings.pauseOnBattery}
                    disabled={
                      radarBackgroundBusy || !radarBackgroundSettings.enabled
                    }
                    type="checkbox"
                    onChange={(event) =>
                      onRadarBackgroundChange(
                        radarBackgroundSettings.enabled,
                        event.target.checked,
                        radarBackgroundSettings.notificationsEnabled,
                      )
                    }
                  />
                  Pause automatic checks on battery power
                </label>
                <label>
                  <input
                    checked={radarBackgroundSettings.notificationsEnabled}
                    disabled={
                      radarBackgroundBusy ||
                      !radarBackgroundSettings.enabled ||
                      !radarBackgroundSettings.notificationCapability.available
                    }
                    type="checkbox"
                    onChange={(event) =>
                      onRadarBackgroundChange(
                        radarBackgroundSettings.enabled,
                        radarBackgroundSettings.pauseOnBattery,
                        event.target.checked,
                      )
                    }
                  />
                  Notify me about newly found releases
                </label>
                {!radarBackgroundSettings.notificationCapability.available && (
                  <p className="notification-capability-hint">
                    {formatNotificationUnavailableReason(
                      radarBackgroundSettings.notificationCapability
                        .unavailableReason,
                    )}
                  </p>
                )}
              </fieldset>
              <dl aria-label="Automatic Radar refresh status">
                <div>
                  <dt>Next check</dt>
                  <dd>
                    {formatBackgroundTime(
                      radarBackgroundSettings.nextRefreshAt,
                      radarBackgroundSettings.enabled
                        ? "Scheduling…"
                        : "Not scheduled",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd>
                    {formatBackgroundTime(
                      radarBackgroundSettings.lastCheckedAt,
                      "Never",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last fully successful</dt>
                  <dd>
                    {formatBackgroundTime(
                      radarBackgroundSettings.lastSuccessfulRefreshAt,
                      "Never",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last result</dt>
                  <dd>{formatBackgroundOutcome(radarBackgroundSettings)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p role="status">Loading automatic refresh settings…</p>
          )}
          {radarBackgroundError && (
            <p className="error" role="alert">
              {radarBackgroundError}
            </p>
          )}
        </div>
      </details>

      {radarRefreshAllResult && (
        <section
          aria-labelledby="radar-refresh-all-result"
          className="radar-refresh-all-result"
        >
          <h2 id="radar-refresh-all-result">Refresh summary</h2>
          <p role="status">
            {radarRefreshAllResult.cancelled
              ? "Stopped after checking "
              : "Checked "}
            {radarRefreshAllResult.completed} of{" "}
            {radarRefreshAllResult.totalFavorites} artists:{" "}
            {radarRefreshAllResult.successful} refreshed and{" "}
            {radarRefreshAllResult.failed} could not be refreshed.
          </p>
          {radarRefreshAllResult.results.length > 0 && (
            <details>
              <summary>
                Refreshed artists ({radarRefreshAllResult.results.length})
              </summary>
              <ul aria-label="Favorites refreshed successfully">
                {radarRefreshAllResult.results.map((result) => (
                  <li key={result.favoriteArtistId}>
                    <strong>{result.favoriteArtistName}</strong>
                    <span>
                      {result.added} new, {result.updated} changed,{" "}
                      {result.unchanged} unchanged
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {radarRefreshAllResult.failures.length > 0 && (
            <ul
              aria-label="Favorites that failed to refresh"
              className="radar-refresh-failures"
            >
              {radarRefreshAllResult.failures.map((failure) => (
                <li key={failure.favoriteArtistId}>
                  <strong>{failure.favoriteArtistName}</strong>
                  <span>{failure.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <RadarReleases
        actionBusyId={radarActionBusyId}
        error={radarError}
        favoriteArtistId={radarFavoriteArtistId}
        favorites={radarFilterFavorites}
        includeDismissed={radarIncludeDismissed}
        items={radarItems}
        limit={radarLimit}
        loading={radarLoading}
        offset={radarOffset}
        primaryType={radarPrimaryType}
        refreshResult={radarRefreshResult}
        summary={radarSummary}
        totalItems={radarTotalItems}
        unseenOnly={radarUnseenOnly}
        view={radarView}
        onDismissed={onRadarDismissed}
        onFavoriteArtistChange={onRadarFavoriteArtistChange}
        onIncludeDismissedChange={onRadarIncludeDismissedChange}
        onOpen={onRadarOpen}
        onPage={onRadarPage}
        onPrimaryTypeChange={onRadarPrimaryTypeChange}
        onSeen={onRadarSeen}
        onUnseenOnlyChange={onRadarUnseenOnlyChange}
        onViewChange={onRadarViewChange}
      />

      <section className="favorite-artists" aria-labelledby="saved-favorites">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Artists you follow</p>
            <h2 id="saved-favorites">Your favorite artists</h2>
            <p>
              Your favorites are saved on this device and remain available
              offline. When you refresh, Outgroove sends MusicBrainz only the
              saved artist IDs needed to check for releases.
            </p>
          </div>
          <form
            aria-label="Search saved favorite artists"
            className="inline"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              onFilterFavorites();
            }}
          >
            <label htmlFor="favorite-artist-filter">Search favorites</label>
            <input
              id="favorite-artist-filter"
              maxLength={200}
              type="search"
              value={favoriteFilterText}
              onChange={(event) =>
                onFavoriteFilterTextChange(event.target.value)
              }
            />
            <button type="submit">Search saved favorites</button>
            {(favoriteFilter || favoriteFilterText) && (
              <button type="button" onClick={onClearFavoriteFilter}>
                Clear favorite search
              </button>
            )}
          </form>
        </div>
        {favorites.length === 0 ? (
          <div className="empty">
            <h3>
              {favoriteFilter
                ? "No favorites match this search"
                : "No favorite artists yet"}
            </h3>
            <p>
              {favoriteFilter
                ? `Nothing matches “${favoriteFilter}”. Your other favorites remain unchanged.`
                : "Find an artist below, review the matches, then choose the right one."}
            </p>
          </div>
        ) : (
          <ul aria-label="Favorite artists">
            {favorites.map((favorite) => (
              <li key={favorite.id}>
                <article>
                  <div>
                    <h3>{favorite.name}</h3>
                    {favorite.disambiguation && (
                      <p>{favorite.disambiguation}</p>
                    )}
                    <p>
                      {[favorite.type, favorite.country]
                        .filter(Boolean)
                        .join(" · ") || "Artist details unavailable"}
                    </p>
                    <code>{favorite.musicBrainzArtistId}</code>
                    <p>
                      {favorite.lastSuccessfulRefreshAt
                        ? `Last successful refresh ${favorite.lastSuccessfulRefreshAt}`
                        : "Not refreshed yet"}
                      {favorite.lastRefreshTruncated &&
                        " · bounded at 500 releases"}
                    </p>
                    <p className="radar-unseen-count">
                      {favorite.unseenRadarCount === 1
                        ? "1 unseen release"
                        : `${favorite.unseenRadarCount} unseen releases`}
                    </p>
                  </div>
                  <div className="favorite-actions">
                    {refreshingFavoriteId === favorite.id ? (
                      <button
                        type="button"
                        onClick={() => onCancelRefresh(favorite)}
                      >
                        Cancel refresh for {favorite.name}
                      </button>
                    ) : (
                      <button
                        disabled={
                          Boolean(refreshingFavoriteId) || radarRefreshAllActive
                        }
                        type="button"
                        onClick={() => onRefreshFavorite(favorite)}
                      >
                        Refresh releases for {favorite.name}
                      </button>
                    )}
                    <button
                      aria-label={`Remove ${favorite.name} from favorites`}
                      className="secondary"
                      disabled={
                        mutationBusy ||
                        Boolean(refreshingFavoriteId) ||
                        radarRefreshAllActive
                      }
                      onClick={() => onRemove(favorite)}
                      type="button"
                    >
                      Remove favorite
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="artist-search"
        aria-labelledby="musicbrainz-artist-search"
      >
        <div className="artist-search-heading">
          <div>
            <p className="eyebrow">MusicBrainz search</p>
            <h2 id="musicbrainz-artist-search">Find an artist</h2>
          </div>
          <p>
            Searching sends only the artist name typed below to MusicBrainz.
            Your audio, file locations, tags, artwork, fingerprints, and saved
            favorites are not sent.
          </p>
        </div>
        <form
          aria-label="Search MusicBrainz for artists"
          className="artist-search-form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchArtists();
          }}
        >
          <label htmlFor="musicbrainz-artist-name">Artist name</label>
          <input
            autoComplete="off"
            id="musicbrainz-artist-name"
            maxLength={200}
            value={artistSearchText}
            onChange={(event) => onArtistSearchTextChange(event.target.value)}
          />
          <button
            className="primary"
            disabled={artistSearchLoading || !artistSearchText.trim()}
            type="submit"
          >
            Search MusicBrainz
          </button>
          {artistSearchLoading && (
            <button type="button" onClick={onCancelArtistSearch}>
              Cancel artist search
            </button>
          )}
        </form>
        {artistSearchLoading && (
          <p aria-live="polite">Searching MusicBrainz for artists…</p>
        )}
        {artistSearchError && (
          <p className="field-error" role="alert">
            {artistSearchError}
          </p>
        )}
        {artistSearchResult && !artistSearchLoading && (
          <div className="artist-search-results">
            <p className="identification-status">
              Reviewed results for “{artistSearchResult.sent.artistName}” ·{" "}
              {artistSearchResult.source === "network"
                ? "loaded from MusicBrainz"
                : artistSearchResult.source === "cache"
                  ? "loaded from local cache"
                  : "showing an expired local cache because MusicBrainz was unavailable"}
            </p>
            {artistSearchResult.candidates.length === 0 ? (
              <div className="empty compact">
                <h3>No artists found</h3>
                <p>Try a more specific or alternate artist name.</p>
              </div>
            ) : (
              <ol aria-label="MusicBrainz artist candidates">
                {artistSearchResult.candidates.map((candidate) => {
                  const alreadyFavorite = favoriteIds.has(candidate.artistId);
                  return (
                    <li key={candidate.artistId}>
                      <article>
                        <header>
                          <div>
                            <h3>{candidate.name}</h3>
                            {candidate.disambiguation && (
                              <p>{candidate.disambiguation}</p>
                            )}
                          </div>
                          <span>{candidate.score}% match</span>
                        </header>
                        <dl>
                          <div>
                            <dt>Type</dt>
                            <dd>{candidate.type ?? "Unknown"}</dd>
                          </div>
                          <div>
                            <dt>Country / area</dt>
                            <dd>
                              {[candidate.country, candidate.area]
                                .filter(Boolean)
                                .join(" · ") || "Unknown"}
                            </dd>
                          </div>
                          <div>
                            <dt>MusicBrainz artist ID</dt>
                            <dd>{candidate.artistId}</dd>
                          </div>
                        </dl>
                        <button
                          disabled={mutationBusy || alreadyFavorite}
                          onClick={() => onAdd(candidate.artistId)}
                          type="button"
                        >
                          {alreadyFavorite
                            ? `${candidate.name} is already a favorite`
                            : `Add ${candidate.name} to favorites`}
                        </button>
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </section>

      {removal && (
        <ModalSheet
          ariaLabel={`Remove ${removal.name} from favorites`}
          closeLabel="Keep favorite"
          onClose={onCancelRemoval}
        >
          <section className="favorite-removal-confirmation">
            <p className="eyebrow">Confirmation required</p>
            <h2>Remove {removal.name}?</h2>
            <p>
              This removes Outgroove’s saved favorite identity and its Radar
              history. It does not change audio, Library tags, provider caches,
              or DAP files.
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={mutationBusy}
                onClick={onConfirmRemoval}
                type="button"
              >
                Confirm remove favorite
              </button>
              <button
                disabled={mutationBusy}
                onClick={onCancelRemoval}
                type="button"
              >
                Keep favorite
              </button>
            </div>
          </section>
        </ModalSheet>
      )}
    </main>
  );
}

function formatBackgroundTime(value: string | null, empty: string): string {
  return value ? new Date(value).toLocaleString() : empty;
}

function formatBackgroundOutcome(
  settings: RadarBackgroundRefreshSettingsDto,
): string {
  if (!settings.lastOutcome) return "No automatic check yet";
  const labels = {
    success: "Fully successful",
    partial: "Partly successful",
    failed: "Failed",
    cancelled: "Stopped for a manual refresh",
    offline: "Paused while offline",
    battery: "Paused on battery power",
    busy: "Deferred while Radar was busy",
  } as const;
  const counts =
    settings.lastOutcome === "success" ||
    settings.lastOutcome === "partial" ||
    settings.lastOutcome === "failed"
      ? ` — ${settings.lastSucceeded} successful, ${settings.lastFailed} failed`
      : "";
  return `${labels[settings.lastOutcome]}${counts}`;
}

function formatNotificationUnavailableReason(
  reason: RadarNotificationUnavailableReason | null,
): string {
  switch (reason) {
    case "development":
      return "Notifications are available only in an installed release build.";
    case "unsigned-macos-build":
      return "This macOS build is unsigned, so reliable native notifications are unavailable.";
    case "portable-windows-build":
      return "Install Outgroove with the Windows Setup application to enable native notifications; the portable ZIP has no stable notification identity.";
    case "unsupported":
    case null:
      return "Native notifications are unavailable on this system.";
  }
}
