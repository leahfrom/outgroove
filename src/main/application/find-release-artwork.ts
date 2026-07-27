import type { CoverArtArchiveResultDto } from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import type { ArtworkThumbnailEncoder } from "../adapters/artwork/artwork-thumbnail";
import type { CoverArtArchiveResult } from "../adapters/providers/cover-art-archive-client";

interface AlbumCatalog {
  getAlbum(id: string): CatalogAlbum | undefined;
}

interface ReleaseArtworkProvider {
  loadFrontArtwork(
    releaseId: string,
    signal: AbortSignal,
  ): Promise<CoverArtArchiveResult>;
}

export class FindReleaseArtwork {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly catalog: AlbumCatalog,
    private readonly provider: ReleaseArtworkProvider,
    private readonly encoder: ArtworkThumbnailEncoder,
  ) {}

  async load(
    albumId: string,
    releaseId: string,
  ): Promise<CoverArtArchiveResultDto> {
    if (!this.catalog.getAlbum(albumId))
      throw new Error("The album is no longer in the Library.");
    this.cancel(albumId);
    const controller = new AbortController();
    this.active.set(albumId, controller);
    try {
      const result = await this.provider.loadFrontArtwork(
        releaseId,
        controller.signal,
      );
      const previewDataUrl = result.artwork
        ? this.encoder.encode(result.artwork.data)
        : undefined;
      if (result.artwork && !previewDataUrl)
        throw new Error(
          "The Cover Art Archive thumbnail could not be decoded safely.",
        );
      return {
        albumId,
        sent: { releaseId },
        artwork:
          result.artwork && previewDataUrl
            ? {
                id: result.artwork.id,
                types: result.artwork.types,
                front: result.artwork.front,
                back: result.artwork.back,
                approved: result.artwork.approved,
                comment: result.artwork.comment,
                previewDataUrl,
                width: result.artwork.width,
                height: result.artwork.height,
                mimeType: result.artwork.mimeType,
                byteLength: result.artwork.data.byteLength,
              }
            : null,
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
