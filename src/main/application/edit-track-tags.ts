import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";

import type {
  TagEditResultDto,
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
}
