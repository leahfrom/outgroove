import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";

import type {
  TagEditHistoryItemDto,
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
      operation.kind !== "album-title-edit" ||
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

  history(albumId: string): readonly TagEditHistoryItemDto[] {
    return this.database.listEditHistory(albumId);
  }

  previewUndo(sourceOperationId: string): TagEditPreviewDto {
    const source = this.database.getEditOperation(sourceOperationId);
    if (
      source?.kind !== "album-title-edit" ||
      (source.state !== "completed" && source.state !== "failed")
    )
      throw new Error("Only a finished album-title edit can be undone.");
    const snapshots = this.database
      .listSnapshots(sourceOperationId)
      .filter((snapshot) => snapshot.verified);
    if (snapshots.length === 0)
      throw new Error("This edit has no verified file changes to undo.");
    const confirmationToken = randomBytes(24).toString("base64url");
    const targetTitles = new Set(
      snapshots.map((snapshot) => snapshot.before.album),
    );
    const proposedTitle =
      targetTitles.size === 1
        ? ([...targetTitles][0] ?? "Previous album title")
        : "Previous per-file album titles";
    const operationId = this.database.createUndoOperation(
      source.album_id,
      sourceOperationId,
      proposedTitle,
      tokenHash(confirmationToken),
    );
    return {
      operationId,
      confirmationToken,
      files: snapshots.map((snapshot) => {
        const extension = extname(snapshot.path).toLocaleLowerCase("en-US");
        const warnings: string[] = [];
        if (snapshot.scanState !== "ok")
          warnings.push("The file is not currently available for writing.");
        if (snapshot.current.album !== snapshot.after.album)
          warnings.push(
            "The album title changed after this edit; undo will not overwrite it.",
          );
        if (!this.writer.writableExtensions.has(extension))
          warnings.push(
            `${extension || "This format"} is read-only in this slice.`,
          );
        return {
          fileId: snapshot.fileId,
          path: snapshot.path,
          before: snapshot.current.album,
          after: snapshot.before.album,
          warnings,
        };
      }),
    };
  }

  async applyUndo(
    operationId: string,
    confirmationToken: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
  ): Promise<TagEditResultDto> {
    const operation = this.database.getEditOperation(operationId);
    if (
      operation?.state !== "previewed" ||
      operation.kind !== "album-title-undo" ||
      !operation.source_operation_id ||
      tokenHash(confirmationToken) !== operation.confirmation_hash
    )
      throw new Error("This undo was not confirmed from its current preview.");
    const source = this.database.getEditOperation(
      operation.source_operation_id,
    );
    if (source?.kind !== "album-title-edit")
      throw new Error("The original album-title edit is no longer available.");
    const snapshots = this.database
      .listSnapshots(source.id)
      .filter((snapshot) => snapshot.verified);
    if (snapshots.length === 0)
      throw new Error("The original edit has no verified changes to undo.");
    if (!this.database.beginEdit(operationId))
      throw new Error("This undo is already being applied or has finished.");

    const results: {
      fileId: string;
      path: string;
      verified: boolean;
      error: string | null;
    }[] = [];
    let completed = 0;
    for (const sourceSnapshot of snapshots) {
      const track = this.database.getTrack(sourceSnapshot.fileId);
      const current = track?.tags ?? sourceSnapshot.current;
      const after: NormalizedTags = {
        ...current,
        album: sourceSnapshot.before.album,
      };
      const snapshotId = this.database.saveSnapshot(
        operationId,
        sourceSnapshot.fileId,
        current,
        after,
      );
      if (
        !track ||
        sourceSnapshot.scanState !== "ok" ||
        current.album !== sourceSnapshot.after.album
      ) {
        const error =
          !track || sourceSnapshot.scanState !== "ok"
            ? "The file is not currently available for writing."
            : "The album title changed after the original edit; undo did not overwrite it.";
        this.database.finishSnapshot(snapshotId, false, error);
        results.push({
          fileId: sourceSnapshot.fileId,
          path: sourceSnapshot.path,
          verified: false,
          error,
        });
      } else {
        try {
          const write = await this.writer.writeAlbumTitle(
            track.path,
            sourceSnapshot.before.album,
          );
          const verified =
            write.file.tags.album === sourceSnapshot.before.album &&
            write.payloadHashBefore === write.payloadHashAfter;
          const error = verified
            ? null
            : "The post-undo metadata or audio-payload verification failed.";
          this.database.finishSnapshot(snapshotId, verified, error);
          if (verified) this.database.updateFileAfterEdit(track.id, write.file);
          results.push({
            fileId: track.id,
            path: track.path,
            verified,
            error,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.database.finishSnapshot(snapshotId, false, message);
          results.push({
            fileId: track.id,
            path: track.path,
            verified: false,
            error: message,
          });
        }
      }
      onProgress(++completed, snapshots.length, sourceSnapshot.path);
    }
    this.database.finishEdit(
      operationId,
      results.every((result) => result.verified),
    );
    return { operationId, results };
  }
}
