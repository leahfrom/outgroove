import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";

import type {
  TagEditResultDto,
  TrackBatchEditPreviewDto,
  TrackTagEditPreviewDto,
} from "../../shared/contracts/api";
import type { NormalizedTags } from "../../shared/domain/catalog";
import {
  changedTrackTags,
  editableTrackTagFields,
  normalizeTrackTagChanges,
} from "../../shared/domain/tag-edit";
import type { TrackTagChanges } from "../../shared/domain/tag-edit";
import type { TrackTagChangeInput } from "../../shared/domain/tag-edit";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { MetadataWriter } from "../adapters/metadata/metadata-writer";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function applyChanges(
  tags: NormalizedTags,
  changes: TrackTagChanges,
): NormalizedTags {
  return { ...tags, ...changes };
}

function targetedFieldsChanged(
  before: NormalizedTags,
  current: NormalizedTags,
  changes: TrackTagChanges,
): boolean {
  return editableTrackTagFields.some(
    (field) => field in changes && before[field] !== current[field],
  );
}

type BatchTagChangeInput = Pick<
  TrackTagChangeInput,
  "artist" | "albumArtist" | "discNumber" | "year"
>;

interface StoredBatchPreview {
  readonly fileId: string;
  readonly tags: NormalizedTags;
}

interface StoredBatchProposal {
  readonly fileId: string;
  readonly changes: TrackTagChanges;
}

export class EditTrackTags {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly writer: MetadataWriter,
  ) {}

  preview(fileId: string, input: TrackTagChangeInput): TrackTagEditPreviewDto {
    const track = this.database.getTrack(fileId);
    const albumId = this.database.getTrackAlbumId(fileId);
    if (!track || !albumId) throw new Error("Track does not exist.");
    const changes = changedTrackTags(
      track.tags,
      normalizeTrackTagChanges(input),
    );
    if (Object.keys(changes).length === 0)
      throw new Error("The proposed metadata already matches this track.");
    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createTrackEditOperation(
      albumId,
      fileId,
      track.tags,
      changes,
      tokenHash(confirmationToken),
    );
    const extension = extname(track.path).toLocaleLowerCase("en-US");
    return {
      operationId,
      confirmationToken,
      fileId,
      path: track.path,
      changes: editableTrackTagFields
        .filter((field) => field in changes)
        .map((field) => ({
          field,
          before: track.tags[field],
          after: changes[field] ?? null,
        })),
      warnings: this.writer.writableExtensions.has(extension)
        ? []
        : [`${extension || "This format"} is read-only in this slice.`],
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
      operation.kind !== "track-tags-edit" ||
      !operation.target_file_id ||
      !operation.preview_tags_json ||
      !operation.proposed_tags_json ||
      tokenHash(confirmationToken) !== operation.confirmation_hash
    )
      throw new Error(
        "This track edit was not confirmed from its current preview.",
      );
    const previewTags = JSON.parse(
      operation.preview_tags_json,
    ) as NormalizedTags;
    const changes = normalizeTrackTagChanges(
      JSON.parse(operation.proposed_tags_json) as TrackTagChanges,
    );
    if (!this.database.beginEdit(operationId))
      throw new Error(
        "This track edit is already being applied or has finished.",
      );

    const target = this.database.getFileEditState(operation.target_file_id);
    const current = target?.tags ?? previewTags;
    const after = applyChanges(current, changes);
    const snapshotId = this.database.saveSnapshot(
      operationId,
      operation.target_file_id,
      current,
      after,
    );
    let verified = false;
    let error: string | null = null;
    if (target?.scanState !== "ok")
      error = "The file is not currently available for writing.";
    else if (targetedFieldsChanged(previewTags, current, changes))
      error =
        "A field in this preview changed after it was created; the edit did not overwrite it.";
    else {
      try {
        const write = await this.writer.writeTags(target.path, changes);
        verified =
          !targetedFieldsChanged(after, write.file.tags, changes) &&
          write.payloadHashBefore === write.payloadHashAfter;
        if (!verified)
          error =
            "The post-write metadata or audio-payload verification failed.";
        else
          this.database.updateFileAfterEdit(
            operation.target_file_id,
            write.file,
          );
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
    this.database.finishSnapshot(snapshotId, verified, error);
    this.database.finishEdit(operationId, verified);
    const path = target?.path ?? "Unavailable track";
    onProgress(1, 1, path);
    return {
      operationId,
      results: [
        {
          fileId: operation.target_file_id,
          path,
          verified,
          error,
        },
      ],
    };
  }

  previewUndo(sourceOperationId: string): TrackTagEditPreviewDto {
    const source = this.database.getEditOperation(sourceOperationId);
    if (
      source?.kind !== "track-tags-edit" ||
      (source.state !== "completed" && source.state !== "failed") ||
      !source.target_file_id ||
      !source.proposed_tags_json
    )
      throw new Error("Only a finished track metadata edit can be undone.");
    const sourceSnapshot = this.database
      .listSnapshots(sourceOperationId)
      .find(
        (snapshot) =>
          snapshot.fileId === source.target_file_id && snapshot.verified,
      );
    if (!sourceSnapshot)
      throw new Error("This edit has no verified metadata change to undo.");
    const sourceChanges = normalizeTrackTagChanges(
      JSON.parse(source.proposed_tags_json) as TrackTagChanges,
    );
    const restoreChanges: TrackTagChanges = {};
    for (const field of editableTrackTagFields)
      if (field in sourceChanges)
        Object.assign(restoreChanges, {
          [field]: sourceSnapshot.before[field],
        });

    const target = this.database.getFileEditState(source.target_file_id);
    const current = target?.tags ?? sourceSnapshot.current;
    const warnings: string[] = [];
    if (target?.scanState !== "ok")
      warnings.push("The file is not currently available for writing.");
    if (targetedFieldsChanged(sourceSnapshot.after, current, restoreChanges))
      warnings.push(
        "A field changed after this edit; undo will not overwrite it.",
      );
    const extension = extname(sourceSnapshot.path).toLocaleLowerCase("en-US");
    if (!this.writer.writableExtensions.has(extension))
      warnings.push(
        `${extension || "This format"} is read-only in this slice.`,
      );
    const albumId =
      this.database.getTrackAlbumId(source.target_file_id) ?? source.album_id;
    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createTrackUndoOperation(
      albumId,
      sourceOperationId,
      source.target_file_id,
      current,
      restoreChanges,
      tokenHash(confirmationToken),
    );
    return {
      operationId,
      confirmationToken,
      fileId: source.target_file_id,
      path: sourceSnapshot.path,
      changes: editableTrackTagFields
        .filter((field) => field in restoreChanges)
        .map((field) => ({
          field,
          before: current[field],
          after: restoreChanges[field] ?? null,
        })),
      warnings,
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
      operation.kind !== "track-tags-undo" ||
      !operation.source_operation_id ||
      !operation.target_file_id ||
      !operation.preview_tags_json ||
      !operation.proposed_tags_json ||
      tokenHash(confirmationToken) !== operation.confirmation_hash
    )
      throw new Error(
        "This track undo was not confirmed from its current preview.",
      );
    const source = this.database.getEditOperation(
      operation.source_operation_id,
    );
    const sourceSnapshot = this.database
      .listSnapshots(operation.source_operation_id)
      .find(
        (snapshot) =>
          snapshot.fileId === operation.target_file_id && snapshot.verified,
      );
    if (source?.kind !== "track-tags-edit" || !sourceSnapshot)
      throw new Error(
        "The original verified track edit is no longer available.",
      );
    const previewTags = JSON.parse(
      operation.preview_tags_json,
    ) as NormalizedTags;
    const changes = normalizeTrackTagChanges(
      JSON.parse(operation.proposed_tags_json) as TrackTagChanges,
    );
    if (!this.database.beginEdit(operationId))
      throw new Error(
        "This track undo is already being applied or has finished.",
      );

    const target = this.database.getFileEditState(operation.target_file_id);
    const current = target?.tags ?? previewTags;
    const after = applyChanges(current, changes);
    const snapshotId = this.database.saveSnapshot(
      operationId,
      operation.target_file_id,
      current,
      after,
    );
    let verified = false;
    let error: string | null = null;
    if (target?.scanState !== "ok")
      error = "The file is not currently available for writing.";
    else if (targetedFieldsChanged(sourceSnapshot.after, current, changes))
      error =
        "A field changed after the original edit; undo did not overwrite it.";
    else if (targetedFieldsChanged(previewTags, current, changes))
      error =
        "A field changed after the undo preview; undo did not overwrite it.";
    else {
      try {
        const write = await this.writer.writeTags(target.path, changes);
        verified =
          !targetedFieldsChanged(after, write.file.tags, changes) &&
          write.payloadHashBefore === write.payloadHashAfter;
        if (!verified)
          error =
            "The post-undo metadata or audio-payload verification failed.";
        else
          this.database.updateFileAfterEdit(
            operation.target_file_id,
            write.file,
          );
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
    this.database.finishSnapshot(snapshotId, verified, error);
    this.database.finishEdit(operationId, verified);
    const path = target?.path ?? sourceSnapshot.path;
    onProgress(1, 1, path);
    return {
      operationId,
      results: [
        {
          fileId: operation.target_file_id,
          path,
          verified,
          error,
        },
      ],
    };
  }

  previewBatch(
    fileIds: readonly string[],
    input: BatchTagChangeInput,
  ): TrackBatchEditPreviewDto {
    const proposed = normalizeTrackTagChanges(input);
    const tracks = fileIds.map((fileId) => {
      const track = this.database.getTrack(fileId);
      const albumId = this.database.getTrackAlbumId(fileId);
      if (!track || !albumId)
        throw new Error("A selected track does not exist.");
      return { fileId, track, albumId };
    });
    const albumId = tracks[0]?.albumId;
    if (!albumId || tracks.some((track) => track.albumId !== albumId))
      throw new Error("Batch edits must stay within one album.");

    const files = tracks.map(({ fileId, track }) => {
      const changes = changedTrackTags(track.tags, proposed);
      const extension = extname(track.path).toLocaleLowerCase("en-US");
      return {
        fileId,
        path: track.path,
        changes: editableTrackTagFields
          .filter((field) => field in changes)
          .map((field) => ({
            field,
            before: track.tags[field],
            after: changes[field] ?? null,
          })),
        warnings: this.writer.writableExtensions.has(extension)
          ? []
          : [`${extension || "This format"} is read-only in this slice.`],
        willWrite: Object.keys(changes).length > 0,
        tags: track.tags,
      };
    });
    const writableFiles = files.filter((file) => file.willWrite);
    if (writableFiles.length === 0)
      throw new Error("The proposed metadata already matches every track.");

    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createTrackBatchEditOperation(
      albumId,
      writableFiles.map(({ fileId, tags }) => ({ fileId, tags })),
      proposed,
      tokenHash(confirmationToken),
    );
    return {
      operationId,
      confirmationToken,
      files: files.map((file) => ({
        fileId: file.fileId,
        path: file.path,
        changes: file.changes,
        warnings: file.warnings,
        willWrite: file.willWrite,
      })),
    };
  }

  async applyBatch(
    operationId: string,
    confirmationToken: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
  ): Promise<TagEditResultDto> {
    const operation = this.database.getEditOperation(operationId);
    if (
      operation?.state !== "previewed" ||
      operation.kind !== "track-tags-batch-edit" ||
      !operation.preview_tags_json ||
      !operation.proposed_tags_json ||
      tokenHash(confirmationToken) !== operation.confirmation_hash
    )
      throw new Error(
        "This batch edit was not confirmed from its current preview.",
      );
    const previews = JSON.parse(
      operation.preview_tags_json,
    ) as StoredBatchPreview[];
    const changes = normalizeTrackTagChanges(
      JSON.parse(operation.proposed_tags_json) as TrackTagChanges,
    );
    if (!this.database.beginEdit(operationId))
      throw new Error(
        "This batch edit is already being applied or has finished.",
      );

    const results: TagEditResultDto["results"][number][] = [];
    for (const [index, preview] of previews.entries()) {
      const target = this.database.getFileEditState(preview.fileId);
      const current = target?.tags ?? preview.tags;
      const after = applyChanges(current, changes);
      const snapshotId = this.database.saveSnapshot(
        operationId,
        preview.fileId,
        current,
        after,
      );
      let verified = false;
      let error: string | null = null;
      if (target?.scanState !== "ok")
        error = "The file is not currently available for writing.";
      else if (targetedFieldsChanged(preview.tags, current, changes))
        error =
          "A field in this preview changed after it was created; the edit did not overwrite it.";
      else {
        try {
          const write = await this.writer.writeTags(target.path, changes);
          verified =
            !targetedFieldsChanged(after, write.file.tags, changes) &&
            write.payloadHashBefore === write.payloadHashAfter;
          if (!verified)
            error =
              "The post-write metadata or audio-payload verification failed.";
          else this.database.updateFileAfterEdit(preview.fileId, write.file);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      }
      this.database.finishSnapshot(snapshotId, verified, error);
      const path = target?.path ?? "Unavailable track";
      results.push({ fileId: preview.fileId, path, verified, error });
      onProgress(index + 1, previews.length, path);
    }
    this.database.finishEdit(
      operationId,
      results.every((result) => result.verified),
    );
    return { operationId, results };
  }

  previewBatchUndo(sourceOperationId: string): TrackBatchEditPreviewDto {
    const source = this.database.getEditOperation(sourceOperationId);
    if (
      source?.kind !== "track-tags-batch-edit" ||
      (source.state !== "completed" && source.state !== "failed") ||
      !source.preview_tags_json ||
      !source.proposed_tags_json
    )
      throw new Error("Only a finished batch metadata edit can be undone.");
    const sourceChanges = normalizeTrackTagChanges(
      JSON.parse(source.proposed_tags_json) as TrackTagChanges,
    );
    const sourceOrder = new Map(
      (JSON.parse(source.preview_tags_json) as StoredBatchPreview[]).map(
        (preview, index) => [preview.fileId, index],
      ),
    );
    const snapshots = this.database
      .listSnapshots(sourceOperationId)
      .filter((snapshot) => snapshot.verified)
      .toSorted(
        (left, right) =>
          (sourceOrder.get(left.fileId) ?? Number.MAX_SAFE_INTEGER) -
          (sourceOrder.get(right.fileId) ?? Number.MAX_SAFE_INTEGER),
      );
    if (snapshots.length === 0)
      throw new Error("This batch has no verified metadata changes to undo.");

    const files = snapshots.map((snapshot) => {
      const restore: TrackTagChanges = {};
      for (const field of editableTrackTagFields)
        if (field in sourceChanges)
          Object.assign(restore, { [field]: snapshot.before[field] });
      const target = this.database.getFileEditState(snapshot.fileId);
      const current = target?.tags ?? snapshot.current;
      const changes = changedTrackTags(current, restore);
      const willWrite = Object.keys(changes).length > 0;
      const warnings: string[] = [];
      if (willWrite && target?.scanState !== "ok")
        warnings.push("The file is not currently available for writing.");
      if (willWrite && targetedFieldsChanged(snapshot.after, current, changes))
        warnings.push(
          "A field changed after this batch edit; undo will not overwrite it.",
        );
      const extension = extname(snapshot.path).toLocaleLowerCase("en-US");
      if (willWrite && !this.writer.writableExtensions.has(extension))
        warnings.push(
          `${extension || "This format"} is read-only in this slice.`,
        );
      return {
        fileId: snapshot.fileId,
        path: snapshot.path,
        tags: current,
        proposed: changes,
        changes: editableTrackTagFields
          .filter((field) => field in changes)
          .map((field) => ({
            field,
            before: current[field],
            after: changes[field] ?? null,
          })),
        warnings,
        willWrite,
      };
    });
    const writableFiles = files.filter((file) => file.willWrite);
    if (writableFiles.length === 0)
      throw new Error("Every verified track already matches its prior tags.");
    const confirmationToken = randomBytes(24).toString("base64url");
    const operationId = this.database.createTrackBatchUndoOperation(
      source.album_id,
      sourceOperationId,
      writableFiles.map(({ fileId, tags }) => ({ fileId, tags })),
      writableFiles.map(({ fileId, proposed }) => ({
        fileId,
        changes: proposed,
      })),
      tokenHash(confirmationToken),
    );
    return {
      operationId,
      confirmationToken,
      files: files.map((file) => ({
        fileId: file.fileId,
        path: file.path,
        changes: file.changes,
        warnings: file.warnings,
        willWrite: file.willWrite,
      })),
    };
  }

  async applyBatchUndo(
    operationId: string,
    confirmationToken: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
  ): Promise<TagEditResultDto> {
    const operation = this.database.getEditOperation(operationId);
    if (
      operation?.state !== "previewed" ||
      operation.kind !== "track-tags-batch-undo" ||
      !operation.source_operation_id ||
      !operation.preview_tags_json ||
      !operation.proposed_tags_json ||
      tokenHash(confirmationToken) !== operation.confirmation_hash
    )
      throw new Error(
        "This batch undo was not confirmed from its current preview.",
      );
    const source = this.database.getEditOperation(
      operation.source_operation_id,
    );
    if (source?.kind !== "track-tags-batch-edit")
      throw new Error("The original batch edit is no longer available.");
    const sourceSnapshots = new Map(
      this.database
        .listSnapshots(operation.source_operation_id)
        .filter((snapshot) => snapshot.verified)
        .map((snapshot) => [snapshot.fileId, snapshot]),
    );
    const previews = JSON.parse(
      operation.preview_tags_json,
    ) as StoredBatchPreview[];
    const proposals = new Map(
      (JSON.parse(operation.proposed_tags_json) as StoredBatchProposal[]).map(
        (proposal) => [
          proposal.fileId,
          normalizeTrackTagChanges(proposal.changes),
        ],
      ),
    );
    if (!this.database.beginEdit(operationId))
      throw new Error(
        "This batch undo is already being applied or has finished.",
      );

    const results: TagEditResultDto["results"][number][] = [];
    for (const [index, preview] of previews.entries()) {
      const sourceSnapshot = sourceSnapshots.get(preview.fileId);
      const changes = proposals.get(preview.fileId);
      const target = this.database.getFileEditState(preview.fileId);
      const current = target?.tags ?? preview.tags;
      const after = changes ? applyChanges(current, changes) : current;
      const snapshotId = this.database.saveSnapshot(
        operationId,
        preview.fileId,
        current,
        after,
      );
      let verified = false;
      let error: string | null = null;
      if (!sourceSnapshot || !changes)
        error = "The original verified file snapshot is no longer available.";
      else if (target?.scanState !== "ok")
        error = "The file is not currently available for writing.";
      else if (targetedFieldsChanged(sourceSnapshot.after, current, changes))
        error =
          "A field changed after the original batch edit; undo did not overwrite it.";
      else if (targetedFieldsChanged(preview.tags, current, changes))
        error =
          "A field changed after the batch undo preview; undo did not overwrite it.";
      else {
        try {
          const write = await this.writer.writeTags(target.path, changes);
          verified =
            !targetedFieldsChanged(after, write.file.tags, changes) &&
            write.payloadHashBefore === write.payloadHashAfter;
          if (!verified)
            error =
              "The post-undo metadata or audio-payload verification failed.";
          else this.database.updateFileAfterEdit(preview.fileId, write.file);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      }
      this.database.finishSnapshot(snapshotId, verified, error);
      const path = target?.path ?? sourceSnapshot?.path ?? "Unavailable track";
      results.push({ fileId: preview.fileId, path, verified, error });
      onProgress(index + 1, previews.length, path);
    }
    this.database.finishEdit(
      operationId,
      results.every((result) => result.verified),
    );
    return { operationId, results };
  }
}
