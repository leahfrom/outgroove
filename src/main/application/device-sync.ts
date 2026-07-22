import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  SyncApplyResultDto,
  SyncCancelResultDto,
  SyncPlanDto,
  SyncPlanItemDto,
  SyncProfileDto,
  SyncRecoveryPreviewDto,
  SyncRecoveryResultDto,
  SyncRecoverySummaryDto,
} from "../../shared/contracts/api";
import type {
  CatalogDatabase,
  SyncRunChangeRecord,
  SyncRunRecord,
} from "../adapters/database/catalog-database";
import { streamingFileHash } from "../adapters/filesystem/streaming-hash";
import { containedDestination, trackDestinationSegments } from "./sync-paths";

interface Manifest {
  readonly version: 1;
  readonly profileId: string;
  readonly entries: readonly {
    sourceFileId: string;
    relativeDestination: string;
    signature: string;
    size: number;
  }[];
}
interface ApplyHooks {
  beforeCopy?: (item: SyncPlanItemDto) => Promise<void>;
  afterCopyInstalled?: (item: SyncPlanItemDto) => Promise<void>;
  beforeManifest?: () => Promise<void>;
  afterTargetManifestInstalled?: () => Promise<void>;
  afterManifestCommitted?: () => Promise<void>;
}
interface ActiveApply {
  readonly controller: AbortController;
  phase: "copying" | "finalizing";
}
interface InstalledCopy {
  readonly destination: string;
  readonly expectedHash: string;
  readonly rollback?: string;
}

async function flushFile(path: string): Promise<void> {
  // Windows rejects FlushFileBuffers/fsync on a read-only handle.
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function deterministicUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const versioned = `${hash.slice(0, 12)}4${hash.slice(13, 16)}8${hash.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error("Refusing a symbolic link in sync recovery.");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function resolveRecordedPath(targetRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath))
    throw new Error("Recovery path must be relative to its DAP target.");
  const root = resolve(targetRoot);
  const absolute = resolve(root, relativePath);
  const comparison = relative(root, absolute);
  if (
    comparison === ".." ||
    comparison.startsWith(`..${sep}`) ||
    isAbsolute(comparison)
  )
    throw new Error("Recovery path escapes its DAP target.");
  return absolute;
}

async function safeRecordedPath(
  targetRoot: string,
  relativePath: string,
): Promise<string> {
  const root = resolve(targetRoot);
  const absolute = resolveRecordedPath(root, relativePath);
  if (!(await pathExists(root)))
    throw new Error("The recorded DAP target is unavailable.");
  let cursor = root;
  const components = relative(root, absolute).split(sep).filter(Boolean);
  for (const component of components) {
    cursor = join(cursor, component);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink())
        throw new Error(
          "Refusing a symbolic link within a recorded sync path.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return absolute;
}

function recordedRelativePath(
  targetRoot: string,
  absolutePath: string,
): string {
  const relativePath = relative(resolve(targetRoot), resolve(absolutePath));
  resolveRecordedPath(targetRoot, relativePath);
  return relativePath;
}

function contentHash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function cancellationRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class DeviceSync {
  private readonly plans = new Map<string, SyncPlanDto>();
  private readonly profileRevisions = new Map<string, number>();
  private readonly applyingProfiles = new Set<string>();
  private readonly activeApplies = new Map<string, ActiveApply>();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly hooks: ApplyHooks = {},
  ) {}

  updateProfileAlbums(
    profileId: string,
    albumIds: readonly string[],
  ): SyncProfileDto {
    if (this.applyingProfiles.has(profileId))
      throw new Error("Wait for the active sync before changing this profile.");
    const profile = this.database.updateSyncProfileAlbums(profileId, albumIds);
    this.profileRevisions.set(
      profileId,
      (this.profileRevisions.get(profileId) ?? 0) + 1,
    );
    for (const [planId, plan] of this.plans)
      if (plan.profileId === profileId) this.plans.delete(planId);
    return profile;
  }

  async plan(profileId: string): Promise<SyncPlanDto> {
    const profileRevision = this.profileRevisions.get(profileId) ?? 0;
    const profile = this.database.getSyncProfile(profileId);
    if (!profile) throw new Error("Sync profile does not exist.");
    const previous = this.database.getLatestManifest(profileId);
    const previousManifest = previous
      ? (JSON.parse(previous.manifest_json) as Manifest)
      : undefined;
    const owned = new Map(
      previousManifest?.entries.map((entry) => [
        entry.relativeDestination.normalize("NFC").toLocaleLowerCase("en-US"),
        entry,
      ]) ?? [],
    );
    const copies: SyncPlanItemDto[] = [];
    const unchanged: SyncPlanItemDto[] = [];
    const conflicts: string[] = [];
    const errors: string[] = [];
    if (this.database.getSyncRunForProfile(profileId))
      errors.push(
        "Recover this profile's interrupted sync before applying another plan.",
      );
    const destinations = new Map<string, string>();
    const albums = profile.album_selections.flatMap((selection) => {
      const album = this.database.getAlbum(selection.id);
      if (album) return [album];
      errors.push(`Selected album “${selection.title}” is unavailable.`);
      return [];
    });
    for (const track of albums.flatMap((album) => album.tracks)) {
      try {
        const sourceInfo = await stat(track.path);
        const signature = `${sourceInfo.size}:${Math.trunc(sourceInfo.mtimeMs)}`;
        const destination = containedDestination(
          profile.target_path,
          trackDestinationSegments(track),
        );
        const comparisonKey = destination.relative
          .normalize("NFC")
          .toLocaleLowerCase("en-US");
        const collision = destinations.get(comparisonKey);
        if (collision) {
          conflicts.push(
            `Destination collision: ${collision} and ${track.path} → ${destination.relative}`,
          );
          continue;
        }
        destinations.set(comparisonKey, track.path);
        const item = {
          sourceFileId: track.id,
          sourcePath: track.path,
          relativeDestination: destination.relative,
          size: sourceInfo.size,
          signature,
        };
        const owner = owned.get(comparisonKey);
        let targetInfo: Awaited<ReturnType<typeof stat>> | undefined;
        try {
          targetInfo = await stat(destination.absolute);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (targetInfo && !owner)
          conflicts.push(
            `Unknown target file would be replaced: ${destination.relative}`,
          );
        else if (
          targetInfo &&
          owner?.signature === signature &&
          targetInfo.size === sourceInfo.size
        )
          unchanged.push(item);
        else copies.push(item);
      } catch (error) {
        errors.push(
          `${track.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const requiredBytes = copies.reduce((sum, item) => sum + item.size, 0);
    try {
      const capacity = await statfs(profile.target_path);
      const available = capacity.bavail * capacity.bsize;
      if (requiredBytes > available)
        errors.push(
          `Insufficient target space: ${requiredBytes} bytes required, ${available} available.`,
        );
    } catch (error) {
      errors.push(
        `Target capacity could not be checked: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const stable = JSON.stringify({
      profileId,
      targetPath: profile.target_path,
      copies,
      unchanged,
      conflicts,
      errors,
      requiredBytes,
    });
    const id = deterministicUuid(stable);
    const confirmationToken = createHash("sha256")
      .update(`outgroove-confirm:${stable}`)
      .digest("base64url");
    const plan: SyncPlanDto = {
      id,
      profileId,
      targetPath: profile.target_path,
      confirmationToken,
      copies,
      unchanged,
      conflicts,
      errors,
      requiredBytes,
    };
    if ((this.profileRevisions.get(profileId) ?? 0) !== profileRevision)
      throw new Error(
        "The DAP profile changed while its preview was being prepared. Preview it again.",
      );
    this.plans.set(id, plan);
    return plan;
  }

  cancel(planId: string): SyncCancelResultDto {
    if (!this.plans.has(planId))
      throw new Error("Sync preview does not exist.");
    const active = this.activeApplies.get(planId);
    if (!active) return { planId, accepted: false, state: "not-running" };
    if (active.phase === "finalizing")
      return { planId, accepted: false, state: "finalizing" };
    active.controller.abort();
    return { planId, accepted: true, state: "cancelling" };
  }

  private recordChange(
    runId: string,
    targetPath: string,
    kind: SyncRunChangeRecord["kind"],
    destination: string,
    expectedHash: string,
    replacesExisting: boolean,
  ): {
    record: SyncRunChangeRecord;
    temporary: string;
    rollback?: string;
  } {
    const temporary = `${destination}.outgroove-${randomUUID()}.tmp`;
    const rollback = replacesExisting
      ? `${destination}.outgroove-${randomUUID()}.rollback`
      : undefined;
    const record = this.database.addSyncRunChange(runId, {
      kind,
      relativeDestination: recordedRelativePath(targetPath, destination),
      temporaryRelative: recordedRelativePath(targetPath, temporary),
      rollbackRelative: rollback
        ? recordedRelativePath(targetPath, rollback)
        : null,
      expectedHash,
    });
    return rollback ? { record, temporary, rollback } : { record, temporary };
  }

  private async installTextArtifact(
    runId: string,
    targetPath: string,
    kind: "playlist" | "manifest",
    relativeDestination: string,
    contents: string,
  ): Promise<InstalledCopy> {
    const destination = await safeRecordedPath(targetPath, relativeDestination);
    await mkdir(dirname(destination), { recursive: true });
    const replacesExisting = await pathExists(destination);
    const prepared = this.recordChange(
      runId,
      targetPath,
      kind,
      destination,
      contentHash(contents),
      replacesExisting,
    );
    await writeFile(prepared.temporary, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await flushFile(prepared.temporary);
    if (prepared.rollback) await rename(destination, prepared.rollback);
    try {
      await rename(prepared.temporary, destination);
    } catch (error) {
      if (prepared.rollback) await rename(prepared.rollback, destination);
      throw error;
    }
    this.database.markSyncRunChangeInstalled(runId, prepared.record.id);
    return {
      destination,
      expectedHash: prepared.record.expectedHash,
      ...(prepared.rollback ? { rollback: prepared.rollback } : {}),
    };
  }

  private async cleanupCommittedRun(run: SyncRunRecord): Promise<string[]> {
    const errors: string[] = [];
    for (const change of run.changes) {
      for (const relativePath of [
        change.temporaryRelative,
        change.rollbackRelative,
      ]) {
        if (!relativePath) continue;
        try {
          await unlinkIfExists(
            await safeRecordedPath(run.targetPath, relativePath),
          );
        } catch (error) {
          errors.push(
            `${relativePath}: committed sync cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    if (errors.length === 0) this.database.deleteSyncRun(run.id);
    return errors;
  }

  private async recoveryPreview(
    run: SyncRunRecord,
  ): Promise<SyncRecoveryPreviewDto> {
    const actions: SyncRecoveryPreviewDto["actions"][number][] = [];
    const warnings: string[] = [];
    let canRecover = true;
    try {
      if (!(await pathExists(run.targetPath))) {
        canRecover = false;
        warnings.push(
          "The DAP target is unavailable. Reconnect the same target and review recovery again.",
        );
      }
    } catch (error) {
      canRecover = false;
      warnings.push(
        `The DAP target cannot be inspected safely: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (canRecover)
      for (const change of [...run.changes].reverse()) {
        try {
          const destination = await safeRecordedPath(
            run.targetPath,
            change.relativeDestination,
          );
          const temporary = await safeRecordedPath(
            run.targetPath,
            change.temporaryRelative,
          );
          const rollback = change.rollbackRelative
            ? await safeRecordedPath(run.targetPath, change.rollbackRelative)
            : undefined;
          if (await pathExists(temporary))
            actions.push({
              path: temporary,
              action: "remove",
              explanation: "Remove an incomplete Outgroove temporary file.",
            });
          if (run.state === "committed-cleanup") {
            if (rollback && (await pathExists(rollback)))
              actions.push({
                path: rollback,
                action: "remove",
                explanation:
                  "Remove the retained pre-sync copy after the successful manifest commit.",
              });
            continue;
          }
          const destinationExists = await pathExists(destination);
          const rollbackExists = rollback ? await pathExists(rollback) : false;
          const destinationMatches = destinationExists
            ? (await streamingFileHash(destination)) === change.expectedHash
            : false;
          if (rollback && rollbackExists) {
            if (!destinationExists || destinationMatches)
              actions.push({
                path: destination,
                action: "restore",
                explanation: `Restore the pre-sync ${change.kind} from ${rollback}.`,
              });
            else
              warnings.push(
                `${destination} changed after the interrupted sync. It will remain untouched; the previous copy remains at ${rollback}.`,
              );
          } else if (!rollback && destinationMatches)
            actions.push({
              path: destination,
              action: "remove",
              explanation: `Remove the uncommitted Outgroove ${change.kind}.`,
            });
          else if (rollback && destinationMatches)
            warnings.push(
              `${destination} contains the interrupted replacement, but its previous copy is unavailable. It will remain untouched.`,
            );
          else if (destinationExists && change.installed)
            warnings.push(
              `${destination} no longer matches the interrupted sync and will remain untouched.`,
            );
        } catch (error) {
          canRecover = false;
          warnings.push(
            `Recovery inspection failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    const stable = JSON.stringify({
      runId: run.id,
      state: run.state,
      updatedAt: run.updatedAt,
      actions,
      warnings,
      canRecover,
    });
    return {
      runId: run.id,
      profileId: run.profileId,
      profileName: run.profileName,
      targetPath: run.targetPath,
      interruptedAt: run.updatedAt,
      phase: run.phase,
      mode:
        run.state === "committed-cleanup" ? "committed-cleanup" : "rollback",
      actions,
      warnings,
      canRecover,
      confirmationToken: createHash("sha256")
        .update(`outgroove-sync-recovery:${stable}`)
        .digest("base64url"),
    };
  }

  listRecoverySummaries(): readonly SyncRecoverySummaryDto[] {
    return this.database
      .listSyncRuns()
      .filter((run) => run.state !== "applying")
      .map((run) => ({
        runId: run.id,
        profileId: run.profileId,
        profileName: run.profileName,
        targetPath: run.targetPath,
        interruptedAt: run.updatedAt,
        phase: run.phase,
        mode:
          run.state === "committed-cleanup" ? "committed-cleanup" : "rollback",
      }));
  }

  async previewRecovery(runId: string): Promise<SyncRecoveryPreviewDto> {
    const run = this.database.getSyncRun(runId);
    if (!run || run.state === "applying")
      throw new Error("Interrupted sync recovery no longer exists.");
    return this.recoveryPreview(run);
  }

  private async recoverChange(
    run: SyncRunRecord,
    change: SyncRunChangeRecord,
  ): Promise<{ recovered: number; notes: string[] }> {
    const notes: string[] = [];
    const destination = await safeRecordedPath(
      run.targetPath,
      change.relativeDestination,
    );
    const temporary = await safeRecordedPath(
      run.targetPath,
      change.temporaryRelative,
    );
    const rollback = change.rollbackRelative
      ? await safeRecordedPath(run.targetPath, change.rollbackRelative)
      : undefined;
    await unlinkIfExists(temporary);
    if (run.state === "committed-cleanup") {
      if (rollback) await unlinkIfExists(rollback);
      return { recovered: 0, notes };
    }
    const destinationExists = await pathExists(destination);
    const rollbackExists = rollback ? await pathExists(rollback) : false;
    const destinationMatches = destinationExists
      ? (await streamingFileHash(destination)) === change.expectedHash
      : false;
    if (rollback && rollbackExists) {
      if (!destinationExists) {
        await rename(rollback, destination);
        return { recovered: 1, notes };
      }
      if (!destinationMatches) {
        notes.push(
          `${destination} changed externally and was left untouched. The previous copy remains at ${rollback}.`,
        );
        return { recovered: 0, notes };
      }
      const quarantine = `${destination}.outgroove-${randomUUID()}.recovery`;
      await rename(destination, quarantine);
      try {
        if ((await streamingFileHash(quarantine)) !== change.expectedHash)
          throw new Error("Destination changed while recovery was applying.");
        await rename(rollback, destination);
        await unlinkIfExists(quarantine);
        return { recovered: 1, notes };
      } catch (error) {
        await rename(quarantine, destination);
        throw error;
      }
    }
    if (rollback) {
      if (destinationMatches)
        notes.push(
          `${destination} was left untouched because its previous copy is unavailable.`,
        );
      return { recovered: 0, notes };
    }
    if (!destinationExists) return { recovered: 0, notes };
    if (!destinationMatches) {
      if (change.installed)
        notes.push(`${destination} changed externally and was left untouched.`);
      return { recovered: 0, notes };
    }
    const quarantine = `${destination}.outgroove-${randomUUID()}.recovery`;
    await rename(destination, quarantine);
    try {
      if ((await streamingFileHash(quarantine)) !== change.expectedHash)
        throw new Error("Destination changed while recovery was applying.");
      await unlinkIfExists(quarantine);
      return { recovered: 1, notes };
    } catch (error) {
      await rename(quarantine, destination);
      throw error;
    }
  }

  async recover(
    runId: string,
    confirmationToken: string,
  ): Promise<SyncRecoveryResultDto> {
    const run = this.database.getSyncRun(runId);
    if (!run || run.state === "applying")
      throw new Error("Interrupted sync recovery no longer exists.");
    const preview = await this.recoveryPreview(run);
    if (preview.confirmationToken !== confirmationToken)
      throw new Error(
        "Sync recovery changed. Review it again before applying.",
      );
    if (!preview.canRecover)
      throw new Error("Reconnect the DAP target before applying recovery.");
    let recovered = 0;
    const errors: string[] = [];
    for (const change of [...run.changes].reverse()) {
      try {
        const result = await this.recoverChange(run, change);
        recovered += result.recovered;
        errors.push(...result.notes);
        this.database.deleteSyncRunChange(run.id, change.id);
      } catch (error) {
        errors.push(
          `${change.relativeDestination}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const complete = this.database.getSyncRun(run.id)?.changes.length === 0;
    if (complete) this.database.deleteSyncRun(run.id);
    return { runId, recovered, errors, complete };
  }

  private async rollbackInstalled(
    installed: readonly InstalledCopy[],
  ): Promise<{ rolledBack: number; errors: string[] }> {
    let rolledBack = 0;
    const errors: string[] = [];
    for (const change of [...installed].reverse()) {
      const quarantine = `${change.destination}.outgroove-${randomUUID()}.cancelled`;
      let quarantineHoldsInstalledCopy = false;
      try {
        await rename(change.destination, quarantine);
        quarantineHoldsInstalledCopy = true;
        if ((await streamingFileHash(quarantine)) !== change.expectedHash) {
          await rename(quarantine, change.destination);
          quarantineHoldsInstalledCopy = false;
          errors.push(
            `${change.destination}: rollback refused because the completed target changed externally.${change.rollback ? ` The previous owned file remains recoverable at ${change.rollback}.` : ""}`,
          );
          continue;
        }
        if (change.rollback) {
          await rename(change.rollback, change.destination);
          quarantineHoldsInstalledCopy = false;
        }
        try {
          await unlinkIfExists(quarantine);
        } catch (error) {
          errors.push(
            `${quarantine}: completed-copy cleanup failed after rollback: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        rolledBack++;
      } catch (error) {
        if (quarantineHoldsInstalledCopy)
          try {
            await rename(quarantine, change.destination);
            quarantineHoldsInstalledCopy = false;
          } catch (restoreError) {
            errors.push(
              `${change.destination}: rollback recovery also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            );
          }
        errors.push(
          `${change.destination}: rollback failed: ${error instanceof Error ? error.message : String(error)}${change.rollback ? ` The previous owned file may remain recoverable at ${change.rollback}.` : ""}`,
        );
      }
    }
    return { rolledBack, errors };
  }

  async apply(
    planId: string,
    confirmationToken: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
  ): Promise<SyncApplyResultDto> {
    const plan = this.plans.get(planId);
    if (plan?.confirmationToken !== confirmationToken)
      throw new Error("Sync must be applied from its current preview.");
    if (plan.conflicts.length > 0 || plan.errors.length > 0)
      throw new Error("Resolve sync conflicts and errors before applying.");
    if (this.applyingProfiles.has(plan.profileId))
      throw new Error("A sync is already applying for this profile.");
    const run = this.database.createSyncRun(
      plan.id,
      plan.profileId,
      plan.targetPath,
    );
    this.applyingProfiles.add(plan.profileId);
    const active: ActiveApply = {
      controller: new AbortController(),
      phase: "copying",
    };
    this.activeApplies.set(planId, active);
    try {
      const errors: string[] = [];
      const installed: InstalledCopy[] = [];
      const previous = this.database.getLatestManifest(plan.profileId);
      const ownedDestinations = new Set(
        previous
          ? (JSON.parse(previous.manifest_json) as Manifest).entries.map(
              (entry) =>
                entry.relativeDestination
                  .normalize("NFC")
                  .toLocaleLowerCase("en-US"),
            )
          : [],
      );
      let copied = 0;
      let cancelled = false;
      let cleanupFailed = false;
      for (const item of plan.copies) {
        if (cancellationRequested(active.controller.signal)) {
          cancelled = true;
          break;
        }
        let temporary: string | undefined;
        try {
          await this.hooks.beforeCopy?.(item);
          if (cancellationRequested(active.controller.signal)) {
            cancelled = true;
            break;
          }
          const sourceInfo = await stat(item.sourcePath);
          if (
            `${sourceInfo.size}:${Math.trunc(sourceInfo.mtimeMs)}` !==
            item.signature
          )
            throw new Error("Source changed after preview; create a new plan.");
          const destination = containedDestination(
            plan.targetPath,
            item.relativeDestination.split(/[\\/]/u),
          );
          await safeRecordedPath(
            plan.targetPath,
            recordedRelativePath(plan.targetPath, destination.absolute),
          );
          await mkdir(dirname(destination.absolute), { recursive: true });
          const sourceHash = await streamingFileHash(item.sourcePath);
          const sourceAfterHash = await stat(item.sourcePath);
          if (
            `${sourceAfterHash.size}:${Math.trunc(sourceAfterHash.mtimeMs)}` !==
            item.signature
          )
            throw new Error(
              "Source changed during verification; create a new plan.",
            );
          const comparisonKey = item.relativeDestination
            .normalize("NFC")
            .toLocaleLowerCase("en-US");
          const prepared = this.recordChange(
            run.id,
            plan.targetPath,
            "copy",
            destination.absolute,
            sourceHash,
            ownedDestinations.has(comparisonKey),
          );
          temporary = prepared.temporary;
          await copyFile(item.sourcePath, temporary);
          await flushFile(temporary);
          const temporaryHash = await streamingFileHash(temporary);
          if (sourceHash !== temporaryHash)
            throw new Error("Copied file verification failed.");
          const sourceAfterCopy = await stat(item.sourcePath);
          if (
            `${sourceAfterCopy.size}:${Math.trunc(sourceAfterCopy.mtimeMs)}` !==
            item.signature
          )
            throw new Error("Source changed during copy; create a new plan.");
          if (cancellationRequested(active.controller.signal)) {
            try {
              await unlinkIfExists(temporary);
            } catch (error) {
              cleanupFailed = true;
              errors.push(
                `${item.relativeDestination}: temporary-copy cleanup after cancellation failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            temporary = undefined;
            cancelled = true;
            break;
          }
          if (ownedDestinations.has(comparisonKey)) {
            if (!prepared.rollback)
              throw new Error("Owned replacement recovery path is missing.");
            await rename(destination.absolute, prepared.rollback);
            try {
              await rename(temporary, destination.absolute);
              temporary = undefined;
            } catch (error) {
              await rename(prepared.rollback, destination.absolute);
              throw error;
            }
            installed.push({
              destination: destination.absolute,
              expectedHash: temporaryHash,
              rollback: prepared.rollback,
            });
          } else {
            // Atomically refuse to clobber a file created after the preview.
            let recordedInstalledCopy = false;
            try {
              await link(temporary, destination.absolute);
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (code === "EEXIST")
                throw new Error(
                  "An unknown target file appeared after preview; nothing was replaced.",
                );
              if (
                code !== "EPERM" &&
                code !== "ENOTSUP" &&
                code !== "EOPNOTSUPP"
              )
                throw error;
              await copyFile(
                temporary,
                destination.absolute,
                constants.COPYFILE_EXCL,
              );
              installed.push({
                destination: destination.absolute,
                expectedHash: temporaryHash,
              });
              recordedInstalledCopy = true;
              if (
                (await streamingFileHash(destination.absolute)) !==
                temporaryHash
              )
                throw new Error("Exclusive target copy verification failed.");
            }
            if (!recordedInstalledCopy)
              installed.push({
                destination: destination.absolute,
                expectedHash: temporaryHash,
              });
            await unlinkIfExists(temporary);
            temporary = undefined;
          }
          this.database.markSyncRunChangeInstalled(run.id, prepared.record.id);
          copied++;
          onProgress(copied, plan.copies.length, item.relativeDestination);
          await this.hooks.afterCopyInstalled?.(item);
        } catch (error) {
          let cleanupFailure = "";
          if (temporary)
            try {
              await unlinkIfExists(temporary);
            } catch (cleanupError) {
              cleanupFailed = true;
              cleanupFailure = ` Temporary-copy cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
            }
          errors.push(
            `${item.relativeDestination}: ${error instanceof Error ? error.message : String(error)}${cleanupFailure}`,
          );
          break;
        }
      }
      const playlistPath = join(plan.targetPath, "Outgroove.m3u8");
      const manifestPath = join(plan.targetPath, ".outgroove", "manifest.json");
      if (cancelled || errors.length > 0) {
        const rollback = await this.rollbackInstalled(installed);
        errors.push(...rollback.errors);
        if (!cleanupFailed && rollback.errors.length === 0)
          this.database.deleteSyncRun(run.id);
        else
          this.database.updateSyncRun(run.id, {
            state: "recovery-required",
          });
        return {
          outcome: cancelled ? "cancelled" : "failed",
          copied,
          rolledBack: rollback.rolledBack,
          unchanged: plan.unchanged.length,
          playlistPath,
          manifestPath,
          errors,
        };
      }
      active.phase = "finalizing";
      this.database.updateSyncRun(run.id, { phase: "finalizing" });
      if (errors.length === 0) {
        const allItems = [...plan.copies, ...plan.unchanged].sort(
          (left, right) =>
            left.relativeDestination.localeCompare(right.relativeDestination),
        );
        installed.push(
          await this.installTextArtifact(
            run.id,
            plan.targetPath,
            "playlist",
            "Outgroove.m3u8",
            `#EXTM3U\n${allItems.map((item) => item.relativeDestination.split("\\").join("/")).join("\n")}\n`,
          ),
        );
        await this.hooks.beforeManifest?.();
        const manifest: Manifest = {
          version: 1,
          profileId: plan.profileId,
          entries: allItems.map((item) => ({
            sourceFileId: item.sourceFileId,
            relativeDestination: item.relativeDestination,
            signature: item.signature,
            size: item.size,
          })),
        };
        installed.push(
          await this.installTextArtifact(
            run.id,
            plan.targetPath,
            "manifest",
            join(".outgroove", "manifest.json"),
            `${JSON.stringify(manifest, null, 2)}\n`,
          ),
        );
        await this.hooks.afterTargetManifestInstalled?.();
        this.database.completeSyncRun(
          run.id,
          plan.profileId,
          plan.targetPath,
          manifest,
        );
        await this.hooks.afterManifestCommitted?.();
        this.plans.delete(planId);
        errors.push(
          ...(await this.cleanupCommittedRun(
            this.database.getSyncRun(run.id) ?? run,
          )),
        );
      }
      return {
        outcome: "completed",
        copied,
        rolledBack: 0,
        unchanged: plan.unchanged.length,
        playlistPath,
        manifestPath,
        errors,
      };
    } catch (error) {
      const current = this.database.getSyncRun(run.id);
      if (current?.state === "applying")
        this.database.updateSyncRun(run.id, { state: "recovery-required" });
      throw error;
    } finally {
      this.activeApplies.delete(planId);
      this.applyingProfiles.delete(plan.profileId);
    }
  }
}
