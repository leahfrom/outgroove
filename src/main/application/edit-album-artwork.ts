import { createHash, randomBytes } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { extname } from "node:path";

import { PictureKind, type PictureInfo } from "@akabeko/music-metadata-editor";

import type {
  AlbumArtworkEditPreviewDto,
  TagEditResultDto,
} from "../../shared/contracts/api";
import type {
  CatalogDatabase,
  StoredArtworkPicture,
} from "../adapters/database/catalog-database";
import type { ArtworkThumbnailEncoder } from "../adapters/artwork/artwork-thumbnail";
import { validatedArtworkSize } from "../adapters/artwork/artwork-image-shape";
import type { MetadataWriter } from "../adapters/metadata/metadata-writer";

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_PREVIEWS = 8;

interface PendingArtworkFile {
  readonly fileId: string;
  readonly path: string;
  readonly expected?: readonly PictureInfo[];
  readonly proposed?: readonly PictureInfo[];
  readonly warning?: string;
  readonly willWrite: boolean;
}

interface PendingArtworkOperation {
  readonly files: readonly PendingArtworkFile[];
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pictureFingerprint(pictures: readonly PictureInfo[]): string {
  const hash = createHash("sha256");
  for (const picture of pictures) {
    hash.update(
      JSON.stringify([
        picture.mimeType,
        picture.kind,
        picture.description ?? "",
        picture.data.byteLength,
      ]),
    );
    hash.update(picture.data);
  }
  return hash.digest("hex");
}

function frontCoverCount(pictures: readonly PictureInfo[]): number {
  return pictures.filter((picture) => picture.kind === PictureKind.CoverFront)
    .length;
}

function replaceFrontCover(
  pictures: readonly PictureInfo[],
  selected: PictureInfo,
): readonly PictureInfo[] {
  const firstFront = pictures.findIndex(
    (picture) => picture.kind === PictureKind.CoverFront,
  );
  const preserved = pictures.filter(
    (picture) => picture.kind !== PictureKind.CoverFront,
  );
  preserved.splice(firstFront < 0 ? 0 : firstFront, 0, selected);
  return preserved;
}

function asPictures(
  pictures: readonly StoredArtworkPicture[],
): readonly PictureInfo[] {
  return pictures.map((picture) => ({
    mimeType: picture.mimeType,
    kind: picture.kind as PictureInfo["kind"],
    ...(picture.description === undefined
      ? {}
      : { description: picture.description }),
    data: picture.data,
  }));
}

async function readSelectedArtwork(path: string): Promise<{
  picture: PictureInfo;
  width: number;
  height: number;
}> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new Error("The selected artwork is no longer available.");
  }
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error("Choose a regular JPEG or PNG file.");
  if (entry.size <= 0 || entry.size > MAX_ARTWORK_BYTES)
    throw new Error("Artwork must be between 1 byte and 8 MiB.");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r");
  } catch {
    throw new Error("The selected artwork could not be opened.");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== entry.size)
      throw new Error("The selected artwork changed while it was being read.");
    const data = Buffer.alloc(entry.size);
    let completed = 0;
    while (completed < data.length) {
      let read: Awaited<ReturnType<typeof handle.read>>;
      try {
        read = await handle.read(
          data,
          completed,
          data.length - completed,
          completed,
        );
      } catch {
        throw new Error("The selected artwork could not be read completely.");
      }
      if (read.bytesRead === 0)
        throw new Error("The selected artwork could not be read completely.");
      completed += read.bytesRead;
    }
    const size = validatedArtworkSize(data);
    if (!size) throw new Error("Choose a valid JPEG or PNG image.");
    const mimeType =
      data[0] === 0x89 && data[1] === 0x50
        ? "image/png"
        : data[0] === 0xff && data[1] === 0xd8
          ? "image/jpeg"
          : undefined;
    if (!mimeType) throw new Error("Choose a valid JPEG or PNG image.");
    return {
      picture: {
        mimeType,
        kind: PictureKind.CoverFront,
        data: new Uint8Array(data),
      },
      width: size.width,
      height: size.height,
    };
  } finally {
    await handle.close();
  }
}

export class EditAlbumArtwork {
  private readonly pending = new Map<string, PendingArtworkOperation>();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly writer: MetadataWriter,
    private readonly encoder: ArtworkThumbnailEncoder,
  ) {}

  async preview(
    albumId: string,
    selectedPath: string,
  ): Promise<AlbumArtworkEditPreviewDto> {
    const album = this.database.getAlbum(albumId);
    if (!album) throw new Error("Album does not exist.");
    const selected = await readSelectedArtwork(selectedPath);
    const dataUrl = this.encoder.encode(selected.picture.data);
    if (!dataUrl)
      throw new Error("The selected artwork could not be decoded safely.");
    const files: PendingArtworkFile[] = [];
    for (const track of album.tracks) {
      const extension = extname(track.path).toLocaleLowerCase("en-US");
      if (!this.writer.writableExtensions.has(extension)) {
        files.push({
          fileId: track.id,
          path: track.path,
          warning: `${extension || "This format"} is read-only in this slice.`,
          willWrite: false,
        });
        continue;
      }
      try {
        const current = await this.writer.readPictures(track.path);
        const proposed = replaceFrontCover(current, selected.picture);
        files.push({
          fileId: track.id,
          path: track.path,
          expected: current,
          proposed,
          willWrite:
            pictureFingerprint(current) !== pictureFingerprint(proposed),
        });
      } catch (error) {
        files.push({
          fileId: track.id,
          path: track.path,
          warning: error instanceof Error ? error.message : String(error),
          willWrite: false,
        });
      }
    }
    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createArtworkEditOperation(
      albumId,
      tokenHash(confirmationToken),
    );
    this.remember(operationId, { files });
    return {
      operationId,
      confirmationToken,
      action: "replace",
      proposedArtworkDataUrl: dataUrl,
      mimeType: selected.picture.mimeType,
      byteLength: selected.picture.data.byteLength,
      width: selected.width,
      height: selected.height,
      files: files.map((file) => ({
        fileId: file.fileId,
        path: file.path,
        currentFrontCovers: file.expected ? frontCoverCount(file.expected) : 0,
        preservedPictures: file.expected
          ? file.expected.length - frontCoverCount(file.expected)
          : 0,
        willWrite: file.willWrite,
        warnings: file.warning ? [file.warning] : [],
      })),
    };
  }

  async previewUndo(
    sourceOperationId: string,
  ): Promise<AlbumArtworkEditPreviewDto> {
    const source = this.database.getEditOperation(sourceOperationId);
    if (
      source?.kind !== "album-artwork-edit" ||
      (source.state !== "completed" && source.state !== "failed")
    )
      throw new Error("Only a finished artwork edit can be undone.");
    const snapshots = this.database
      .listArtworkSnapshots(sourceOperationId)
      .filter((snapshot) => snapshot.verified);
    if (snapshots.length === 0)
      throw new Error("This edit has no verified artwork changes to undo.");
    const files: PendingArtworkFile[] = [];
    for (const snapshot of snapshots) {
      try {
        const current = await this.writer.readPictures(snapshot.path);
        const expected = asPictures(snapshot.afterPictures);
        files.push({
          fileId: snapshot.fileId,
          path: snapshot.path,
          expected: current,
          proposed: asPictures(snapshot.beforePictures),
          ...(pictureFingerprint(current) === pictureFingerprint(expected)
            ? {}
            : {
                warning:
                  "Embedded artwork changed after this edit; undo will not overwrite it.",
              }),
          willWrite:
            pictureFingerprint(current) === pictureFingerprint(expected),
        });
      } catch (error) {
        files.push({
          fileId: snapshot.fileId,
          path: snapshot.path,
          warning: error instanceof Error ? error.message : String(error),
          willWrite: false,
        });
      }
    }
    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createArtworkUndoOperation(
      source.album_id,
      sourceOperationId,
      tokenHash(confirmationToken),
    );
    this.remember(operationId, { files });
    const targetFront = files
      .flatMap((file) => file.proposed ?? [])
      .find((picture) => picture.kind === PictureKind.CoverFront);
    const proposedArtworkDataUrl = targetFront
      ? this.encoder.encode(targetFront.data)
      : undefined;
    return {
      operationId,
      confirmationToken,
      action: "restore",
      ...(targetFront && proposedArtworkDataUrl
        ? {
            proposedArtworkDataUrl,
            mimeType: targetFront.mimeType,
            byteLength: targetFront.data.byteLength,
          }
        : {}),
      files: files.map((file) => ({
        fileId: file.fileId,
        path: file.path,
        currentFrontCovers: file.expected ? frontCoverCount(file.expected) : 0,
        preservedPictures: file.proposed?.length ?? 0,
        willWrite: file.willWrite,
        warnings: file.warning ? [file.warning] : [],
      })),
    };
  }

  async apply(
    operationId: string,
    confirmationToken: string,
    expectedKind: "album-artwork-edit" | "album-artwork-undo",
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
  ): Promise<TagEditResultDto> {
    const operation = this.database.getEditOperation(operationId);
    const pending = this.pending.get(operationId);
    if (
      operation?.state !== "previewed" ||
      operation.kind !== expectedKind ||
      tokenHash(confirmationToken) !== operation.confirmation_hash ||
      !pending
    )
      throw new Error(
        "This artwork change was not confirmed from its current preview.",
      );
    if (!this.database.beginEdit(operationId))
      throw new Error(
        "This artwork change is already being applied or has finished.",
      );
    const results: TagEditResultDto["results"][number][] = [];
    let completed = 0;
    for (const file of pending.files) {
      const track = this.database.getTrack(file.fileId);
      let snapshotId: string | undefined;
      try {
        if (!track || !file.expected || !file.proposed || file.warning)
          throw new Error(
            file.warning ?? "The file is not currently available for writing.",
          );
        const current = await this.writer.readPictures(file.path);
        if (pictureFingerprint(current) !== pictureFingerprint(file.expected))
          throw new Error(
            "Embedded artwork changed after the preview; this file was not overwritten.",
          );
        if (!file.willWrite) {
          results.push({
            fileId: file.fileId,
            path: file.path,
            verified: true,
            error: null,
          });
          onProgress(++completed, pending.files.length, file.path);
          continue;
        }
        snapshotId = this.database.saveArtworkSnapshot(
          operationId,
          file.fileId,
          track.tags,
          current,
          file.proposed,
        );
        const write = await this.writer.writePictures(file.path, file.proposed);
        const finalPictures = await this.writer.readPictures(file.path);
        const picturesVerified =
          pictureFingerprint(finalPictures) ===
          pictureFingerprint(file.proposed);
        const payloadVerified =
          write.payloadHashBefore === write.payloadHashAfter;
        const verified = picturesVerified && payloadVerified;
        const error = verified
          ? null
          : !picturesVerified
            ? "The post-write artwork verification failed."
            : "The post-write audio-payload verification failed.";
        this.database.finishSnapshot(snapshotId, verified, error);
        if (verified)
          this.database.updateFileAfterEdit(file.fileId, write.file);
        results.push({
          fileId: file.fileId,
          path: file.path,
          verified,
          error,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!snapshotId && track)
          snapshotId = this.database.saveSnapshot(
            operationId,
            file.fileId,
            track.tags,
            track.tags,
          );
        if (snapshotId)
          this.database.finishSnapshot(snapshotId, false, message);
        results.push({
          fileId: file.fileId,
          path: file.path,
          verified: false,
          error: message,
        });
      }
      onProgress(++completed, pending.files.length, file.path);
    }
    this.pending.delete(operationId);
    this.database.finishEdit(
      operationId,
      results.every((result) => result.verified),
    );
    return { operationId, results };
  }

  private remember(
    operationId: string,
    operation: PendingArtworkOperation,
  ): void {
    this.pending.set(operationId, operation);
    while (this.pending.size > MAX_PENDING_PREVIEWS) {
      const oldest = this.pending.keys().next().value;
      if (!oldest) break;
      this.pending.delete(oldest);
    }
  }
}
