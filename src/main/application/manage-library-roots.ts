import { createHash, randomUUID } from "node:crypto";

import type {
  LibraryRootRemovalPreviewDto,
  LibraryRootRemovalResultDto,
} from "../../shared/contracts/api";
import type { CatalogDatabase } from "../adapters/database/catalog-database";

interface PendingRemoval extends LibraryRootRemovalPreviewDto {
  readonly snapshot: string;
}

function snapshotFor(
  impact: Omit<
    LibraryRootRemovalPreviewDto,
    "operationId" | "confirmationToken"
  >,
): string {
  return JSON.stringify(impact);
}

export class ManageLibraryRoots {
  private readonly removals = new Map<string, PendingRemoval>();

  constructor(private readonly database: CatalogDatabase) {}

  previewRemoval(rootId: string): LibraryRootRemovalPreviewDto {
    if (this.database.getActiveScanJob(rootId))
      throw new Error("Cancel this folder's active scan before removing it.");
    const impact = this.database.getLibraryRootRemovalImpact(rootId);
    if (!impact) throw new Error("Watched Library folder does not exist.");
    const operationId = randomUUID();
    const snapshot = snapshotFor(impact);
    const confirmationToken = createHash("sha256")
      .update(`${operationId}:${snapshot}`)
      .digest("base64url");
    for (const [pendingId, pending] of this.removals)
      if (pending.rootId === rootId) this.removals.delete(pendingId);
    const pending = {
      operationId,
      confirmationToken,
      ...impact,
      snapshot,
    };
    this.removals.set(operationId, pending);
    return {
      operationId,
      confirmationToken,
      rootId: pending.rootId,
      path: pending.path,
      visibleTracks: pending.visibleTracks,
      albumsHidden: pending.albumsHidden,
      scanProblemsHidden: pending.scanProblemsHidden,
    };
  }

  applyRemoval(
    operationId: string,
    confirmationToken: string,
  ): LibraryRootRemovalResultDto {
    const preview = this.removals.get(operationId);
    if (preview?.confirmationToken !== confirmationToken)
      throw new Error(
        "Folder removal must be applied from its current preview.",
      );
    if (this.database.getActiveScanJob(preview.rootId))
      throw new Error("Cancel this folder's active scan before removing it.");
    const current = this.database.getLibraryRootRemovalImpact(preview.rootId);
    if (!current || snapshotFor(current) !== preview.snapshot)
      throw new Error(
        "The Library folder changed after preview. Review its removal again.",
      );
    const result = this.database.stopWatchingLibraryRoot(preview.rootId);
    this.removals.delete(operationId);
    return result;
  }
}
