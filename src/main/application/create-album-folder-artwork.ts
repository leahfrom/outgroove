import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, normalize, resolve } from "node:path";

import type {
  AlbumFolderArtworkPreviewDto,
  AlbumFolderArtworkResultDto,
} from "../../shared/contracts/api";
import type { ArtworkThumbnailEncoder } from "../adapters/artwork/artwork-thumbnail";
import { validatedArtworkInfo } from "../adapters/artwork/artwork-image-shape";
import { readLocalArtwork } from "../adapters/artwork/local-artwork";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import { streamingFileHash } from "../adapters/filesystem/streaming-hash";

const MAX_PENDING_CREATIONS = 8;
const CONVENTIONAL_ARTWORK_NAMES = new Set([
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "front.jpg",
  "front.jpeg",
  "front.png",
]);

interface PendingFolderArtwork extends AlbumFolderArtworkPreviewDto {
  readonly albumId: string;
  readonly albumFolder: string;
  readonly canonicalFolder: string;
  readonly sourceHash: string;
  readonly data: Uint8Array;
}

export interface FolderArtworkCreationHooks {
  readonly afterInstall?: (destinationPath: string) => Promise<void>;
  readonly afterCreated?: (albumId: string) => void;
}

class FolderArtworkCreationError extends Error {}

function hash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

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

async function validateAlbumFolder(
  tracks: readonly { readonly path: string }[],
): Promise<{ readonly folder: string; readonly canonicalFolder: string }> {
  const folders = new Set(
    tracks.map((track) => dirname(normalize(resolve(track.path)))),
  );
  if (folders.size !== 1)
    throw new Error(
      "Folder artwork is available only when every track is in one folder.",
    );
  const folder = [...folders][0];
  if (!folder) throw new Error("This album has no available folder.");
  const entry = await lstat(folder);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(
      "Folder artwork cannot be created through a symbolic link.",
    );
  const canonicalFolder = await realpath(folder);
  return { folder, canonicalFolder };
}

async function assertNoConventionalArtwork(folder: string): Promise<void> {
  const entries = await readdir(folder, { withFileTypes: true });
  const existing = entries.find((entry) =>
    CONVENTIONAL_ARTWORK_NAMES.has(entry.name.toLocaleLowerCase("en-US")),
  );
  if (existing)
    throw new Error(
      `${existing.name} already exists. Outgroove will not replace existing folder artwork.`,
    );
}

async function assertOnlyInstalledArtwork(
  folder: string,
  installedName: string,
): Promise<void> {
  const entries = await readdir(folder, { withFileTypes: true });
  const conventional = entries.filter((entry) =>
    CONVENTIONAL_ARTWORK_NAMES.has(entry.name.toLocaleLowerCase("en-US")),
  );
  if (
    conventional.length !== 1 ||
    conventional[0]?.name !== installedName ||
    !conventional[0].isFile() ||
    conventional[0].isSymbolicLink()
  )
    throw new FolderArtworkCreationError(
      "Conflicting folder artwork appeared during creation.",
    );
}

export class CreateAlbumFolderArtwork {
  private readonly pending = new Map<
    string,
    { readonly tokenHash: string; readonly preview: PendingFolderArtwork }
  >();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly encoder: ArtworkThumbnailEncoder,
    private readonly hooks: FolderArtworkCreationHooks = {},
  ) {}

  async preview(albumId: string): Promise<AlbumFolderArtworkPreviewDto> {
    const album = this.database.getAlbum(albumId);
    const track = album?.tracks[0];
    if (!album || !track) throw new Error("Album does not exist.");
    const { folder, canonicalFolder } = await validateAlbumFolder(album.tracks);
    await assertNoConventionalArtwork(folder);
    const candidate = await readLocalArtwork(track.path);
    if (candidate.status !== "available" || candidate.source !== "embedded")
      throw new Error(
        "This album has no supported embedded cover to copy into its folder.",
      );
    const info = validatedArtworkInfo(candidate.data);
    const artworkDataUrl = this.encoder.encode(candidate.data);
    if (!info || !artworkDataUrl)
      throw new Error("The current embedded cover cannot be decoded safely.");
    const fileName = info.mimeType === "image/jpeg" ? "cover.jpg" : "cover.png";
    const destinationPath = join(folder, fileName);
    if (dirname(destinationPath) !== folder)
      throw new Error("The folder artwork destination is not contained.");
    const operationId = randomUUID();
    const confirmationToken = randomBytes(24).toString("base64url");
    const preview: PendingFolderArtwork = {
      operationId,
      confirmationToken,
      albumId,
      artworkDataUrl,
      mimeType: info.mimeType,
      byteLength: candidate.data.byteLength,
      width: info.width,
      height: info.height,
      destinationPath,
      albumFolder: folder,
      canonicalFolder,
      sourceHash: hash(candidate.data),
      data: candidate.data.slice(),
    };
    this.pending.set(operationId, {
      tokenHash: tokenHash(confirmationToken),
      preview,
    });
    while (this.pending.size > MAX_PENDING_CREATIONS) {
      const oldest = this.pending.keys().next().value;
      if (!oldest) break;
      this.pending.delete(oldest);
    }
    return this.toDto(preview);
  }

  async apply(
    operationId: string,
    confirmationToken: string,
  ): Promise<AlbumFolderArtworkResultDto> {
    const preview = this.authorize(operationId, confirmationToken);
    const album = this.database.getAlbum(preview.albumId);
    if (!album) throw new Error("Album does not exist.");
    const currentFolder = await validateAlbumFolder(album.tracks);
    if (
      currentFolder.folder !== preview.albumFolder ||
      currentFolder.canonicalFolder !== preview.canonicalFolder
    )
      throw new Error(
        "The album folder changed after the preview; nothing was created.",
      );
    await assertNoConventionalArtwork(preview.albumFolder);
    const source = await readLocalArtwork(album.tracks[0]?.path ?? "");
    if (
      source.status !== "available" ||
      source.source !== "embedded" ||
      hash(source.data) !== preview.sourceHash
    )
      throw new Error(
        "The embedded cover changed after the preview; nothing was created.",
      );

    const expectedHash = hash(preview.data);
    const temporary = join(
      preview.albumFolder,
      `.${basename(preview.destinationPath)}.outgroove-${randomUUID()}.tmp`,
    );
    let installed: { readonly path: string } | undefined;
    try {
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(temporary, "wx");
      } catch {
        throw new FolderArtworkCreationError(
          "Outgroove could not create a temporary folder-artwork file.",
        );
      }
      try {
        await handle.writeFile(preview.data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if ((await streamingFileHash(temporary)) !== expectedHash)
        throw new FolderArtworkCreationError(
          "The temporary folder artwork failed verification.",
        );
      try {
        await link(temporary, preview.destinationPath);
        installed = { path: preview.destinationPath };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST")
          throw new FolderArtworkCreationError(
            "Folder artwork appeared after the preview. Nothing was replaced.",
          );
        if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP")
          throw new FolderArtworkCreationError(
            "The folder artwork could not be installed.",
          );
        try {
          await copyFile(
            temporary,
            preview.destinationPath,
            constants.COPYFILE_EXCL,
          );
          installed = { path: preview.destinationPath };
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code === "EEXIST")
            throw new FolderArtworkCreationError(
              "Folder artwork appeared after the preview. Nothing was replaced.",
            );
          throw new FolderArtworkCreationError(
            "The folder artwork could not be copied.",
          );
        }
      }
      await this.hooks.afterInstall?.(preview.destinationPath);
      await assertOnlyInstalledArtwork(
        preview.albumFolder,
        basename(preview.destinationPath),
      );
      if ((await streamingFileHash(preview.destinationPath)) !== expectedHash)
        throw new FolderArtworkCreationError(
          "The folder artwork changed before verification completed.",
        );
      await unlinkIfExists(temporary);
      this.pending.delete(operationId);
      this.hooks.afterCreated?.(preview.albumId);
      return {
        albumId: preview.albumId,
        destinationPath: preview.destinationPath,
        byteLength: preview.data.byteLength,
        sha256: expectedHash,
      };
    } catch (error) {
      await unlinkIfExists(temporary);
      if (installed) {
        try {
          if ((await streamingFileHash(installed.path)) === expectedHash)
            await unlink(installed.path);
        } catch {
          // Preserve a destination changed externally after installation.
        }
      }
      if (error instanceof FolderArtworkCreationError) throw error;
      throw new Error("Folder artwork could not be created safely.");
    }
  }

  private authorize(
    operationId: string,
    confirmationToken: string,
  ): PendingFolderArtwork {
    const pending = this.pending.get(operationId);
    if (pending?.tokenHash !== tokenHash(confirmationToken))
      throw new Error(
        "This folder artwork was not confirmed from its current preview.",
      );
    return pending.preview;
  }

  private toDto(preview: PendingFolderArtwork): AlbumFolderArtworkPreviewDto {
    return {
      operationId: preview.operationId,
      confirmationToken: preview.confirmationToken,
      artworkDataUrl: preview.artworkDataUrl,
      mimeType: preview.mimeType,
      byteLength: preview.byteLength,
      width: preview.width,
      height: preview.height,
      destinationPath: preview.destinationPath,
    };
  }
}
