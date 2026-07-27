import type {
  AlbumArtworkEditPreviewDto,
  CoverArtArchiveResultDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import type { ArtworkThumbnailEncoder } from "../adapters/artwork/artwork-thumbnail";
import type {
  CoverArtArchiveArtwork,
  CoverArtArchiveResult,
} from "../adapters/providers/cover-art-archive-client";

interface AlbumCatalog {
  getAlbum(id: string): CatalogAlbum | undefined;
}

interface ReleaseArtworkProvider {
  loadFrontArtwork(
    releaseId: string,
    signal: AbortSignal,
  ): Promise<CoverArtArchiveResult>;
  loadOriginalFrontArtwork(
    releaseId: string,
    expectedArtworkId: string,
    signal: AbortSignal,
  ): Promise<CoverArtArchiveArtwork>;
}

interface ReleaseArtworkEditor {
  previewData(
    albumId: string,
    data: Uint8Array,
    source: NonNullable<AlbumArtworkEditPreviewDto["proposedArtworkSource"]>,
  ): Promise<AlbumArtworkEditPreviewDto>;
}

export class FindReleaseArtwork {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly catalog: AlbumCatalog,
    private readonly provider: ReleaseArtworkProvider,
    private readonly encoder: ArtworkThumbnailEncoder,
    private readonly editor: ReleaseArtworkEditor,
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

  async previewReplacement(
    albumId: string,
    releaseId: string,
    artworkId: string,
  ): Promise<AlbumArtworkEditPreviewDto> {
    if (!this.catalog.getAlbum(albumId))
      throw new Error("The album is no longer in the Library.");
    this.cancel(albumId);
    const controller = new AbortController();
    this.active.set(albumId, controller);
    try {
      const artwork = await this.provider.loadOriginalFrontArtwork(
        releaseId,
        artworkId,
        controller.signal,
      );
      if (artwork.id !== artworkId)
        throw new Error(
          "The Cover Art Archive returned a different artwork identity.",
        );
      return await this.editor.previewData(albumId, artwork.data, {
        kind: "cover-art-archive",
        releaseId,
        artworkId,
      });
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
