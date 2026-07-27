import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, open, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type {
  AlbumArtworkExportPreviewDto,
  AlbumArtworkExportResultDto,
} from "../../shared/contracts/api";
import type { ArtworkThumbnailEncoder } from "../adapters/artwork/artwork-thumbnail";
import { validatedArtworkInfo } from "../adapters/artwork/artwork-image-shape";
import { readLocalArtwork } from "../adapters/artwork/local-artwork";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import { streamingFileHash } from "../adapters/filesystem/streaming-hash";

const MAX_PENDING_EXPORTS = 8;

interface PendingArtworkExport extends AlbumArtworkExportPreviewDto {
  readonly data: Uint8Array;
}

export interface ArtworkExportHooks {
  readonly afterInstall?: (destinationPath: string) => Promise<void>;
}

class ArtworkExportError extends Error {}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export class ExportAlbumArtwork {
  private readonly pending = new Map<
    string,
    { readonly tokenHash: string; readonly preview: PendingArtworkExport }
  >();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly encoder: ArtworkThumbnailEncoder,
    private readonly hooks: ArtworkExportHooks = {},
  ) {}

  async preview(albumId: string): Promise<AlbumArtworkExportPreviewDto> {
    const album = this.database.getAlbum(albumId);
    const track = album?.tracks[0];
    if (!album || !track) throw new Error("Album does not exist.");
    const candidate = await readLocalArtwork(track.path);
    if (candidate.status !== "available")
      throw new Error(
        candidate.status === "missing"
          ? "This album has no local artwork to export."
          : "The current local artwork cannot be exported safely.",
      );
    const info = validatedArtworkInfo(candidate.data);
    const artworkDataUrl = this.encoder.encode(candidate.data);
    if (!info || !artworkDataUrl)
      throw new Error("The current local artwork cannot be decoded safely.");
    const operationId = randomUUID();
    const confirmationToken = randomBytes(24).toString("base64url");
    const preview: PendingArtworkExport = {
      operationId,
      confirmationToken,
      artworkDataUrl,
      source: candidate.source,
      mimeType: info.mimeType,
      byteLength: candidate.data.byteLength,
      width: info.width,
      height: info.height,
      suggestedFileName:
        info.mimeType === "image/jpeg" ? "cover.jpg" : "cover.png",
      data: candidate.data.slice(),
    };
    this.pending.set(operationId, {
      tokenHash: tokenHash(confirmationToken),
      preview,
    });
    while (this.pending.size > MAX_PENDING_EXPORTS) {
      const oldest = this.pending.keys().next().value;
      if (!oldest) break;
      this.pending.delete(oldest);
    }
    return {
      operationId: preview.operationId,
      confirmationToken: preview.confirmationToken,
      artworkDataUrl: preview.artworkDataUrl,
      source: preview.source,
      mimeType: preview.mimeType,
      byteLength: preview.byteLength,
      width: preview.width,
      height: preview.height,
      suggestedFileName: preview.suggestedFileName,
    };
  }

  exportDetails(
    operationId: string,
    confirmationToken: string,
  ): {
    readonly suggestedFileName: string;
    readonly mimeType: "image/jpeg" | "image/png";
  } {
    const pending = this.authorize(operationId, confirmationToken);
    return {
      suggestedFileName: pending.suggestedFileName,
      mimeType: pending.mimeType,
    };
  }

  async exportTo(
    operationId: string,
    confirmationToken: string,
    destinationPath: string,
  ): Promise<AlbumArtworkExportResultDto> {
    const pending = this.authorize(operationId, confirmationToken);
    const extension = extname(destinationPath).toLocaleLowerCase("en-US");
    const allowedExtensions =
      pending.mimeType === "image/jpeg" ? [".jpg", ".jpeg"] : [".png"];
    if (!allowedExtensions.includes(extension))
      throw new Error(
        pending.mimeType === "image/jpeg"
          ? "Choose a .jpg or .jpeg destination for this artwork."
          : "Choose a .png destination for this artwork.",
      );
    const expectedHash = createHash("sha256")
      .update(pending.data)
      .digest("hex");
    const temporary = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.outgroove-${randomUUID()}.tmp`,
    );
    let installed: { readonly path: string } | undefined;
    try {
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(temporary, "wx");
      } catch {
        throw new ArtworkExportError(
          "The artwork export could not create a temporary file.",
        );
      }
      try {
        await handle.writeFile(pending.data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if ((await streamingFileHash(temporary)) !== expectedHash)
        throw new ArtworkExportError(
          "The temporary artwork export failed verification.",
        );

      try {
        await link(temporary, destinationPath);
        installed = { path: destinationPath };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST")
          throw new ArtworkExportError(
            "That destination already exists. Choose a different name.",
          );
        if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP")
          throw new ArtworkExportError(
            "The artwork could not be installed at that destination.",
          );
        try {
          await copyFile(temporary, destinationPath, constants.COPYFILE_EXCL);
          installed = { path: destinationPath };
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code === "EEXIST")
            throw new ArtworkExportError(
              "That destination already exists. Choose a different name.",
            );
          throw new ArtworkExportError(
            "The artwork could not be copied to that destination.",
          );
        }
      }

      await this.hooks.afterInstall?.(destinationPath);
      if ((await streamingFileHash(destinationPath)) !== expectedHash)
        throw new ArtworkExportError(
          "The exported artwork changed before verification completed.",
        );
      await unlinkIfExists(temporary);
      this.pending.delete(operationId);
      return {
        destinationPath,
        byteLength: pending.data.byteLength,
        sha256: expectedHash,
      };
    } catch (error) {
      await unlinkIfExists(temporary);
      if (installed) {
        try {
          if ((await streamingFileHash(installed.path)) === expectedHash)
            await unlink(installed.path);
        } catch {
          // A destination changed externally after installation is preserved.
        }
      }
      if (error instanceof ArtworkExportError) throw error;
      throw new Error("The artwork export could not be completed safely.");
    }
  }

  private authorize(
    operationId: string,
    confirmationToken: string,
  ): PendingArtworkExport {
    const pending = this.pending.get(operationId);
    if (pending?.tokenHash !== tokenHash(confirmationToken))
      throw new Error(
        "This artwork export was not confirmed from its current preview.",
      );
    return pending.preview;
  }
}
