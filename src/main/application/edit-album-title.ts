import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";

import type {
  TagEditPreviewDto,
  TagEditResultDto,
} from "../../shared/contracts/api";
import type { NormalizedTags } from "../../shared/domain/catalog";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { MetadataWriter } from "../adapters/metadata/metadata-writer";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class EditAlbumTitle {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly writer: MetadataWriter,
  ) {}

  preview(albumId: string, proposedTitle: string): TagEditPreviewDto {
    const album = this.database.getAlbum(albumId);
    if (!album) throw new Error("Album does not exist.");
    const title = proposedTitle.normalize("NFC").replace(/\s+/gu, " ").trim();
    if (!title) throw new Error("Album title cannot be empty.");
    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createEditOperation(
      albumId,
      title,
      tokenHash(confirmationToken),
    );
    return {
      operationId,
      confirmationToken,
      files: album.tracks.map((track) => {
        const extension = extname(track.path).toLocaleLowerCase("en-US");
        return {
          fileId: track.id,
          path: track.path,
          before: track.tags.album,
          after: title,
          warnings: this.writer.writableExtensions.has(extension)
            ? []
            : [`${extension || "This format"} is read-only in this slice.`],
        };
      }),
    };
  }

  async apply(
    operationId: string,
    confirmationToken: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
  ): Promise<TagEditResultDto> {
    const operation = this.database.getEditOperation(operationId);
    if (
      operation?.state !== "previewed" ||
      tokenHash(confirmationToken) !== operation.confirmation_hash
    )
      throw new Error("This edit was not confirmed from its current preview.");
    const album = this.database.getAlbum(operation.album_id);
    if (!album) throw new Error("The previewed album is no longer available.");
    if (!this.database.beginEdit(operationId))
      throw new Error("This edit is already being applied or has finished.");
    const results: {
      fileId: string;
      path: string;
      verified: boolean;
      error: string | null;
    }[] = [];
    let completed = 0;
    for (const track of album.tracks) {
      const after: NormalizedTags = {
        ...track.tags,
        album: operation.proposed_title,
      };
      const snapshotId = this.database.saveSnapshot(
        operationId,
        track.id,
        track.tags,
        after,
      );
      try {
        const write = await this.writer.writeAlbumTitle(
          track.path,
          operation.proposed_title,
        );
        const verified =
          write.file.tags.album === operation.proposed_title &&
          write.payloadHashBefore === write.payloadHashAfter;
        const error = verified
          ? null
          : "The post-write metadata or audio-payload verification failed.";
        this.database.finishSnapshot(snapshotId, verified, error);
        if (verified) this.database.updateFileAfterEdit(track.id, write.file);
        results.push({ fileId: track.id, path: track.path, verified, error });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.database.finishSnapshot(snapshotId, false, message);
        results.push({
          fileId: track.id,
          path: track.path,
          verified: false,
          error: message,
        });
      }
      onProgress(++completed, album.tracks.length, track.path);
    }
    const successful = results.every((result) => result.verified);
    this.database.finishEdit(operationId, successful);
    return { operationId, results };
  }
}
