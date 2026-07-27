import type {
  FavoriteArtistDto,
  FavoriteArtistSearchResultDto,
} from "../../shared/contracts/api";
import type { MusicBrainzArtistCandidate } from "../../shared/domain/favorite-artist";

interface FavoriteArtistStore {
  listFavoriteArtists(query?: string): readonly FavoriteArtistDto[];
  addFavoriteArtist(candidate: MusicBrainzArtistCandidate): FavoriteArtistDto;
  removeFavoriteArtist(id: string): { readonly id: string };
}

interface FavoriteArtistProvider {
  searchArtists(
    query: string,
    signal: AbortSignal,
  ): Promise<{
    readonly candidates: readonly MusicBrainzArtistCandidate[];
    readonly source: "network" | "cache" | "stale-cache";
    readonly fetchedAt: string;
  }>;
}

export class ManageFavoriteArtists {
  private active: AbortController | undefined;
  private reviewedCandidates = new Map<string, MusicBrainzArtistCandidate>();

  constructor(
    private readonly store: FavoriteArtistStore,
    private readonly musicBrainz: FavoriteArtistProvider,
  ) {}

  list(query: string): readonly FavoriteArtistDto[] {
    return this.store.listFavoriteArtists(query);
  }

  async search(query: string): Promise<FavoriteArtistSearchResultDto> {
    this.cancel();
    this.reviewedCandidates.clear();
    const controller = new AbortController();
    this.active = controller;
    try {
      const result = await this.musicBrainz.searchArtists(
        query,
        controller.signal,
      );
      if (this.active !== controller)
        throw new DOMException(
          "The MusicBrainz artist search was cancelled.",
          "AbortError",
        );
      this.reviewedCandidates = new Map(
        result.candidates.map((candidate) => [candidate.artistId, candidate]),
      );
      return {
        sent: { artistName: query },
        candidates: result.candidates,
        source: result.source,
        fetchedAt: result.fetchedAt,
        readOnly: true,
      };
    } finally {
      if (this.active === controller) this.active = undefined;
    }
  }

  add(artistId: string): FavoriteArtistDto {
    const candidate = this.reviewedCandidates.get(artistId);
    if (!candidate)
      throw new Error(
        "Search MusicBrainz and select an artist from the current reviewed results.",
      );
    return this.store.addFavoriteArtist(candidate);
  }

  remove(id: string): { readonly id: string } {
    return this.store.removeFavoriteArtist(id);
  }

  cancel(): { readonly cancelled: boolean } {
    if (!this.active) return { cancelled: false };
    this.active.abort();
    this.active = undefined;
    return { cancelled: true };
  }
}
