import type {
  FavoriteArtistDto,
  RadarItemDto,
  RadarPageDto,
  RadarRefreshResultDto,
} from "../../shared/contracts/api";
import type { RadarReleaseGroupObservation } from "../../shared/domain/radar";
import type { RadarPrimaryTypeFilter } from "../../shared/domain/radar";

interface RadarStore {
  getFavoriteArtist(id: string): FavoriteArtistDto | undefined;
  commitRadarRefresh(
    favoriteArtistId: string,
    observations: readonly RadarReleaseGroupObservation[],
    refresh: {
      readonly refreshedAt: string;
      readonly providerFetchedAt: string;
      readonly truncated: boolean;
    },
  ): {
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
  };
  listRadarItems(
    view: "all" | "upcoming" | "recent" | "newly-found",
    primaryType: RadarPrimaryTypeFilter,
    includeDismissed: boolean,
    today: string,
    offset: number,
    limit: number,
  ): RadarPageDto;
  setRadarItemSeen(
    id: string,
    seen: boolean,
    changedAt: string,
    today: string,
  ): RadarItemDto;
  setRadarItemDismissed(
    id: string,
    dismissed: boolean,
    changedAt: string,
    today: string,
  ): RadarItemDto;
}

interface RadarProvider {
  browseArtistReleases(
    artistId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly observations: readonly RadarReleaseGroupObservation[];
    readonly source: "network" | "cache" | "stale-cache";
    readonly fetchedAt: string;
    readonly truncated: boolean;
  }>;
}

export class RefreshRadar {
  private active:
    | {
        readonly favoriteArtistId: string;
        readonly controller: AbortController;
      }
    | undefined;

  constructor(
    private readonly store: RadarStore,
    private readonly provider: RadarProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async refresh(favoriteArtistId: string): Promise<RadarRefreshResultDto> {
    this.cancelActive();
    const favorite = this.store.getFavoriteArtist(favoriteArtistId);
    if (!favorite) throw new Error("The favorite artist no longer exists.");
    const controller = new AbortController();
    this.active = { favoriteArtistId, controller };
    try {
      const result = await this.provider.browseArtistReleases(
        favorite.musicBrainzArtistId,
        controller.signal,
      );
      if (!this.isActive(controller))
        throw new DOMException(
          "The Radar refresh was cancelled.",
          "AbortError",
        );
      if (result.source === "stale-cache")
        throw new Error(
          "MusicBrainz is unavailable. Outgroove kept the last successful Radar view unchanged.",
        );
      const refreshedAt = this.now().toISOString();
      const committed = this.store.commitRadarRefresh(
        favoriteArtistId,
        result.observations,
        {
          refreshedAt,
          providerFetchedAt: result.fetchedAt,
          truncated: result.truncated,
        },
      );
      return {
        favoriteArtistId,
        favoriteArtistName: favorite.name,
        ...committed,
        total: result.observations.length,
        source: result.source,
        providerFetchedAt: result.fetchedAt,
        refreshedAt,
        truncated: result.truncated,
      };
    } finally {
      if (this.isActive(controller)) this.active = undefined;
    }
  }

  cancel(favoriteArtistId: string): { readonly cancelled: boolean } {
    if (this.active?.favoriteArtistId !== favoriteArtistId)
      return { cancelled: false };
    this.cancelActive();
    return { cancelled: true };
  }

  list(
    view: "all" | "upcoming" | "recent" | "newly-found",
    primaryType: RadarPrimaryTypeFilter,
    includeDismissed: boolean,
    offset: number,
    limit: number,
  ): RadarPageDto {
    return this.store.listRadarItems(
      view,
      primaryType,
      includeDismissed,
      this.today(),
      offset,
      limit,
    );
  }

  setSeen(id: string, seen: boolean): RadarItemDto {
    const changedAt = this.now().toISOString();
    return this.store.setRadarItemSeen(
      id,
      seen,
      changedAt,
      changedAt.slice(0, 10),
    );
  }

  setDismissed(id: string, dismissed: boolean): RadarItemDto {
    const changedAt = this.now().toISOString();
    return this.store.setRadarItemDismissed(
      id,
      dismissed,
      changedAt,
      changedAt.slice(0, 10),
    );
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private cancelActive(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }

  private isActive(controller: AbortController): boolean {
    return this.active?.controller === controller;
  }
}
