import type { AlbumIdentificationResultDto } from "../../shared/contracts/api";
import {
  compareAlbumCandidates,
  type AlbumIdentificationCandidate,
} from "../../shared/domain/album-identification";
import type { CatalogAlbum } from "../../shared/domain/catalog";

interface AlbumCatalog {
  getAlbum(id: string): CatalogAlbum | undefined;
}

interface AlbumCandidateProvider {
  searchReleases(
    title: string,
    artist: string,
    signal: AbortSignal,
  ): Promise<{
    readonly candidates: readonly AlbumIdentificationCandidate[];
    readonly source: "network" | "cache" | "stale-cache";
    readonly fetchedAt: string;
  }>;
}

export class FindAlbumCandidates {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly catalog: AlbumCatalog,
    private readonly musicBrainz: AlbumCandidateProvider,
  ) {}

  async search(albumId: string): Promise<AlbumIdentificationResultDto> {
    const album = this.catalog.getAlbum(albumId);
    if (!album) throw new Error("The album is no longer in the Library.");
    this.cancel(albumId);
    const controller = new AbortController();
    this.active.set(albumId, controller);
    try {
      const result = await this.musicBrainz.searchReleases(
        album.title,
        album.albumArtist,
        controller.signal,
      );
      return {
        albumId,
        sent: {
          albumTitle: album.title,
          albumArtist: album.albumArtist,
        },
        candidates: compareAlbumCandidates(album, result.candidates),
        source: result.source,
        fetchedAt: result.fetchedAt,
        readOnly: true,
      };
    } finally {
      if (this.active.get(albumId) === controller) this.active.delete(albumId);
    }
  }

  cancel(albumId: string): { readonly cancelled: boolean } {
    const controller = this.active.get(albumId);
    if (!controller) return { cancelled: false };
    controller.abort();
    this.active.delete(albumId);
    return { cancelled: true };
  }
}
