import type { AlbumArtworkThumbnailDto } from "../../shared/contracts/api";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { ArtworkThumbnailEncoder } from "../adapters/artwork/artwork-thumbnail";
import { readLocalArtwork } from "../adapters/artwork/local-artwork";

const MAX_CACHE_ENTRIES = 100;
const MAX_CACHE_CHARACTERS = 32 * 1024 * 1024;
const MAX_CONCURRENT_LOADS = 4;

export class LoadAlbumArtwork {
  private readonly cache = new Map<string, AlbumArtworkThumbnailDto>();
  private cacheCharacters = 0;

  constructor(
    private readonly database: CatalogDatabase,
    private readonly encoder: ArtworkThumbnailEncoder,
  ) {}

  async load(
    albumIds: readonly string[],
  ): Promise<readonly AlbumArtworkThumbnailDto[]> {
    const results: AlbumArtworkThumbnailDto[] = [];
    for (
      let offset = 0;
      offset < albumIds.length;
      offset += MAX_CONCURRENT_LOADS
    )
      results.push(
        ...(await Promise.all(
          albumIds
            .slice(offset, offset + MAX_CONCURRENT_LOADS)
            .map((albumId) => this.loadOne(albumId)),
        )),
      );
    return results;
  }

  private async loadOne(albumId: string): Promise<AlbumArtworkThumbnailDto> {
    const album = this.database.getAlbum(albumId);
    const track = album?.tracks[0];
    if (!track) return { albumId, status: "missing" };
    const cacheKey = `${albumId}:${track.id}:${track.size}:${track.modifiedMs}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const candidate = await readLocalArtwork(track.path);
    const dataUrl =
      candidate.status === "available"
        ? this.encoder.encode(candidate.data)
        : undefined;
    const result: AlbumArtworkThumbnailDto = dataUrl
      ? { albumId, status: "available", dataUrl }
      : {
          albumId,
          status:
            candidate.status === "available" ? "invalid" : candidate.status,
        };
    this.cache.set(cacheKey, result);
    this.cacheCharacters += result.dataUrl?.length ?? 0;
    while (
      this.cache.size > MAX_CACHE_ENTRIES ||
      this.cacheCharacters > MAX_CACHE_CHARACTERS
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.cache.get(oldestKey);
      this.cacheCharacters -= oldest?.dataUrl?.length ?? 0;
      this.cache.delete(oldestKey);
    }
    return result;
  }
}
