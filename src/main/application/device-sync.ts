import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
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
  SyncProfileRemovalPreviewDto,
  SyncProfileRemovalResultDto,
  SyncProfileTargetPreviewDto,
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
import { inspectTargetFilesystem } from "../adapters/filesystem/target-volume";
import { containedDestination, trackDestinationSegments } from "./sync-paths";

export type TargetFilesystemInspector = typeof inspectTargetFilesystem;

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
  beforeRemoval?: (item: SyncPlanDto["removals"][number]) => Promise<void>;
  afterRemovalQuarantined?: (
    item: SyncPlanDto["removals"][number],
  ) => Promise<void>;
  beforeManifest?: () => Promise<void>;
  afterTargetManifestInstalled?: () => Promise<void>;
  afterManifestCommitted?: () => Promise<void>;
}
interface ActiveApply {
  readonly controller: AbortController;
  phase: "copying" | "finalizing";
}
interface InstalledCopy {
  readonly kind: "copy";
  readonly destination: string;
  readonly expectedHash: string;
  readonly rollback?: string;
}
interface InstalledRemoval {
  readonly kind: "removal";
  readonly destination: string;
  readonly quarantine: string;
  readonly expectedHash: string;
}
type InstalledChange = InstalledCopy | InstalledRemoval;

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

function manifestHash(manifestJson: string | undefined): string | null {
  return manifestJson === undefined ? null : contentHash(manifestJson);
}

function parseManifest(manifestJson: string): Manifest {
  const parsed = JSON.parse(manifestJson) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("profileId" in parsed) ||
    typeof parsed.profileId !== "string" ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries) ||
    parsed.entries.some(
      (entry: unknown) =>
        typeof entry !== "object" ||
        entry === null ||
        !("sourceFileId" in entry) ||
        typeof entry.sourceFileId !== "string" ||
        !("relativeDestination" in entry) ||
        typeof entry.relativeDestination !== "string" ||
        !("signature" in entry) ||
        typeof entry.signature !== "string" ||
        !("size" in entry) ||
        typeof entry.size !== "number" ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0,
    )
  )
    throw new Error("Stored sync manifest is invalid.");
  return parsed as Manifest;
}

function cancellationRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class DeviceSync {
  private readonly plans = new Map<string, SyncPlanDto>();
  private readonly planVolumeIdentities = new Map<string, string | null>();
  private readonly profileRevisions = new Map<string, number>();
  private readonly applyingProfiles = new Set<string>();
  private readonly activeApplies = new Map<string, ActiveApply>();
  private readonly targetPreviews = new Map<
    string,
    {
      readonly preview: SyncProfileTargetPreviewDto;
      readonly currentVolumeIdentity: string | null;
      readonly proposedRootIdentity: string;
      readonly proposedVolumeIdentity: string | null;
    }
  >();
  private readonly profileRemovalPreviews = new Map<
    string,
    SyncProfileRemovalPreviewDto
  >();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly hooks: ApplyHooks = {},
    private readonly inspectTarget: TargetFilesystemInspector = inspectTargetFilesystem,
  ) {}

  private deletePlan(planId: string): void {
    this.plans.delete(planId);
    this.planVolumeIdentities.delete(planId);
  }

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
      if (plan.profileId === profileId) this.deletePlan(planId);
    return profile;
  }

  async previewProfileTarget(
    profileId: string,
    proposedTargetPath: string,
  ): Promise<SyncProfileTargetPreviewDto> {
    const profile = this.database.getSyncProfile(profileId);
    if (!profile) throw new Error("Sync profile does not exist.");
    const proposedEvidence = await this.inspectTarget(proposedTargetPath);
    const identityRefresh = profile.target_path === proposedTargetPath;
    if (
      identityRefresh &&
      proposedEvidence.volumeIdentity === profile.target_volume_identity
    )
      throw new Error(
        "This DAP profile already uses the selected target and recorded volume identity.",
      );
    if (identityRefresh && proposedEvidence.volumeIdentity === null)
      throw new Error(
        "A persistent volume identity is unavailable for this target, so there is no stronger evidence to save.",
      );
    const operationId = randomUUID();
    const stable = JSON.stringify({
      operationId,
      profileId,
      currentTargetPath: profile.target_path,
      currentVolumeIdentity: profile.target_volume_identity,
      proposedTargetPath,
      proposedVolumeIdentity: proposedEvidence.volumeIdentity,
    });
    const preview = {
      operationId,
      confirmationToken: createHash("sha256")
        .update(`outgroove-sync-target:${stable}`)
        .digest("base64url"),
      profileId,
      profileName: profile.name,
      currentTargetPath: profile.target_path,
      proposedTargetPath,
      proposedVolumeEvidenceAvailable: proposedEvidence.volumeIdentity !== null,
      identityRefresh,
    };
    this.targetPreviews.set(operationId, {
      preview,
      currentVolumeIdentity: profile.target_volume_identity,
      proposedRootIdentity: proposedEvidence.rootIdentity,
      proposedVolumeIdentity: proposedEvidence.volumeIdentity,
    });
    return preview;
  }

  async applyProfileTarget(
    operationId: string,
    confirmationToken: string,
  ): Promise<SyncProfileDto> {
    const storedPreview = this.targetPreviews.get(operationId);
    if (!storedPreview) throw new Error("DAP target preview does not exist.");
    const {
      preview,
      currentVolumeIdentity,
      proposedRootIdentity,
      proposedVolumeIdentity,
    } = storedPreview;
    if (preview.confirmationToken !== confirmationToken)
      throw new Error("DAP target confirmation no longer matches the preview.");
    if (this.applyingProfiles.has(preview.profileId))
      throw new Error("Wait for the active sync before changing this profile.");
    if (this.database.getSyncRunForProfile(preview.profileId))
      throw new Error(
        "Recover this profile's interrupted sync before changing its target.",
      );
    const current = this.database.getSyncProfile(preview.profileId);
    if (
      current?.target_path !== preview.currentTargetPath ||
      current.target_volume_identity !== currentVolumeIdentity
    )
      throw new Error(
        "The DAP profile changed after preview. Choose its target again.",
      );
    const currentEvidence = await this.inspectTarget(
      preview.proposedTargetPath,
    );
    if (
      currentEvidence.rootIdentity !== proposedRootIdentity ||
      currentEvidence.volumeIdentity !== proposedVolumeIdentity
    )
      throw new Error(
        "The selected DAP target changed after preview. Choose it again.",
      );
    const profile = this.database.updateSyncProfileTarget(
      preview.profileId,
      preview.proposedTargetPath,
      proposedVolumeIdentity,
    );
    this.profileRevisions.set(
      preview.profileId,
      (this.profileRevisions.get(preview.profileId) ?? 0) + 1,
    );
    for (const [planId, plan] of this.plans)
      if (plan.profileId === preview.profileId) this.deletePlan(planId);
    for (const [id, candidate] of this.targetPreviews)
      if (candidate.preview.profileId === preview.profileId)
        this.targetPreviews.delete(id);
    return profile;
  }

  previewProfileRemoval(profileId: string): SyncProfileRemovalPreviewDto {
    if (this.applyingProfiles.has(profileId))
      throw new Error("Wait for the active sync before removing this profile.");
    if (this.database.getSyncRunForProfile(profileId))
      throw new Error(
        "Recover this profile's interrupted sync before removing it.",
      );
    const state = this.profileRemovalState(profileId);
    const operationId = randomUUID();
    const stable = JSON.stringify({ operationId, ...state });
    const preview = {
      operationId,
      confirmationToken: createHash("sha256")
        .update(`outgroove-sync-profile-removal:${stable}`)
        .digest("base64url"),
      ...state,
    };
    this.profileRemovalPreviews.set(operationId, preview);
    return preview;
  }

  applyProfileRemoval(
    operationId: string,
    confirmationToken: string,
  ): SyncProfileRemovalResultDto {
    const preview = this.profileRemovalPreviews.get(operationId);
    if (!preview)
      throw new Error("DAP profile removal preview does not exist.");
    if (preview.confirmationToken !== confirmationToken)
      throw new Error(
        "DAP profile removal confirmation no longer matches the preview.",
      );
    if (this.applyingProfiles.has(preview.profileId))
      throw new Error("Wait for the active sync before removing this profile.");
    if (this.database.getSyncRunForProfile(preview.profileId))
      throw new Error(
        "Recover this profile's interrupted sync before removing it.",
      );
    const current = this.profileRemovalState(preview.profileId);
    const reviewed = {
      profileId: preview.profileId,
      profileName: preview.profileName,
      targetPath: preview.targetPath,
      albums: preview.albums,
      successfulSyncs: preview.successfulSyncs,
      manifestTargets: preview.manifestTargets,
    };
    if (JSON.stringify(current) !== JSON.stringify(reviewed))
      throw new Error(
        "The DAP profile changed after preview. Review its removal again.",
      );
    const removedSuccessfulSyncs = this.database.deleteSyncProfile(
      preview.profileId,
    );
    for (const [planId, plan] of this.plans)
      if (plan.profileId === preview.profileId) this.deletePlan(planId);
    for (const [id, candidate] of this.targetPreviews)
      if (candidate.preview.profileId === preview.profileId)
        this.targetPreviews.delete(id);
    for (const [id, candidate] of this.profileRemovalPreviews)
      if (candidate.profileId === preview.profileId)
        this.profileRemovalPreviews.delete(id);
    this.profileRevisions.delete(preview.profileId);
    return {
      profileId: preview.profileId,
      profileName: preview.profileName,
      removedSuccessfulSyncs,
    };
  }

  private profileRemovalState(
    profileId: string,
  ): Omit<SyncProfileRemovalPreviewDto, "operationId" | "confirmationToken"> {
    const state = this.database.getSyncProfileRemovalState(profileId);
    return {
      profileId: state.profile.id,
      profileName: state.profile.name,
      targetPath: state.profile.targetPath,
      albums: state.profile.albums,
      successfulSyncs: state.successfulSyncs,
      manifestTargets: state.manifestTargets,
    };
  }

  async plan(profileId: string, cleanupEnabled = false): Promise<SyncPlanDto> {
    const profileRevision = this.profileRevisions.get(profileId) ?? 0;
    const profile = this.database.getSyncProfile(profileId);
    if (!profile) throw new Error("Sync profile does not exist.");
    const previous = this.database.getLatestManifest(
      profileId,
      profile.target_path,
    );
    const previousManifest = previous
      ? parseManifest(previous.manifest_json)
      : undefined;
    if (previousManifest && previousManifest.profileId !== profileId)
      throw new Error("Stored sync manifest belongs to another DAP profile.");
    const owned = new Map<
      string,
      NonNullable<typeof previousManifest>["entries"][number]
    >();
    const copies: SyncPlanItemDto[] = [];
    const replacements: SyncPlanItemDto[] = [];
    const unchanged: SyncPlanItemDto[] = [];
    const removals: SyncPlanDto["removals"][number][] = [];
    const absentOwned: string[] = [];
    const conflicts: string[] = [];
    const errors: string[] = [];
    let plannedTargetIdentity = "";
    let currentVolumeIdentity: string | null = null;
    try {
      const evidence = await this.inspectTarget(profile.target_path);
      plannedTargetIdentity = evidence.rootIdentity;
      currentVolumeIdentity = evidence.volumeIdentity;
    } catch (error) {
      errors.push(
        `DAP target: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const targetVolumeStatus: SyncPlanDto["targetVolume"]["status"] =
      currentVolumeIdentity === null
        ? "unavailable"
        : profile.target_volume_identity === null
          ? "unrecorded"
          : currentVolumeIdentity === profile.target_volume_identity
            ? "matched"
            : "changed";
    const targetVolume = {
      status: targetVolumeStatus,
      confirmationRequired: targetVolumeStatus !== "matched",
    } as const;
    for (const entry of previousManifest?.entries ?? []) {
      const comparisonKey = entry.relativeDestination
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (owned.has(comparisonKey))
        errors.push(
          `Earlier manifest contains a case or Unicode collision: ${entry.relativeDestination}`,
        );
      else owned.set(comparisonKey, entry);
    }
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
        const baseItem = {
          sourceFileId: track.id,
          sourcePath: track.path,
          relativeDestination: destination.relative,
          size: sourceInfo.size,
          signature,
        };
        const owner = owned.get(comparisonKey);
        if (owner && owner.relativeDestination !== destination.relative) {
          conflicts.push(
            `Manifest-owned destination differs by case or Unicode: ${owner.relativeDestination} and ${destination.relative}`,
          );
          continue;
        }
        await safeRecordedPath(profile.target_path, destination.relative);
        let targetInfo: Awaited<ReturnType<typeof lstat>> | undefined;
        try {
          targetInfo = await lstat(destination.absolute);
          if (targetInfo.isSymbolicLink())
            throw new Error(
              `Refusing a symbolic link at target destination: ${destination.relative}`,
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (targetInfo && !owner)
          conflicts.push(
            `Unknown target file would be replaced: ${destination.relative}`,
          );
        else if (targetInfo && owner) {
          const expectedTargetHash = await streamingFileHash(
            destination.absolute,
          );
          const item = { ...baseItem, expectedTargetHash };
          if (
            owner.signature === signature &&
            targetInfo.size === sourceInfo.size
          )
            unchanged.push(item);
          else replacements.push(item);
        } else copies.push(baseItem);
      } catch (error) {
        errors.push(
          `${track.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (cleanupEnabled)
      for (const [comparisonKey, entry] of [...owned].sort(
        ([, left], [, right]) =>
          left.relativeDestination.localeCompare(right.relativeDestination),
      )) {
        if (destinations.has(comparisonKey)) continue;
        try {
          const destination = await safeRecordedPath(
            profile.target_path,
            entry.relativeDestination,
          );
          let info: Awaited<ReturnType<typeof lstat>>;
          try {
            info = await lstat(destination);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              absentOwned.push(entry.relativeDestination);
              continue;
            }
            throw error;
          }
          if (info.isSymbolicLink())
            throw new Error("Refusing a symbolic link at an owned path.");
          if (!info.isFile())
            throw new Error("Manifest-owned target path is not a file.");
          if (info.size !== entry.size)
            throw new Error(
              "Manifest-owned target size no longer matches its ownership record.",
            );
          removals.push({
            relativeDestination: entry.relativeDestination,
            size: info.size,
            expectedTargetHash: await streamingFileHash(destination),
          });
        } catch (error) {
          errors.push(
            `${entry.relativeDestination}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    for (const relativeArtifact of [
      "Outgroove.m3u8",
      join(".outgroove", "manifest.json"),
    ]) {
      try {
        const artifact = await safeRecordedPath(
          profile.target_path,
          relativeArtifact,
        );
        if ((await pathExists(artifact)) && !previous)
          conflicts.push(
            `Unknown target file would be replaced: ${relativeArtifact}`,
          );
      } catch (error) {
        errors.push(
          `${relativeArtifact}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (previous) {
      try {
        const targetManifestPath = await safeRecordedPath(
          profile.target_path,
          join(".outgroove", "manifest.json"),
        );
        const targetManifest = parseManifest(
          await readFile(targetManifestPath, "utf8"),
        );
        if (JSON.stringify(targetManifest) !== JSON.stringify(previousManifest))
          errors.push(
            "The target manifest no longer matches Outgroove’s latest ownership record.",
          );
      } catch (error) {
        errors.push(
          `Target manifest: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const requiredBytes = [...copies, ...replacements].reduce(
      (sum, item) => sum + item.size,
      0,
    );
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
      cleanupEnabled,
      previousManifestHash: manifestHash(previous?.manifest_json),
      targetIdentity: plannedTargetIdentity,
      currentVolumeIdentity,
      targetVolume,
      copies,
      replacements,
      unchanged,
      removals,
      absentOwned,
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
      cleanupEnabled,
      previousManifestHash: manifestHash(previous?.manifest_json),
      targetIdentity: plannedTargetIdentity,
      targetVolume,
      copies,
      replacements,
      unchanged,
      removals,
      absentOwned,
      conflicts,
      errors,
      requiredBytes,
      hasChanges:
        copies.length +
          replacements.length +
          removals.length +
          absentOwned.length >
        0,
    };
    if ((this.profileRevisions.get(profileId) ?? 0) !== profileRevision)
      throw new Error(
        "The DAP profile changed while its preview was being prepared. Preview it again.",
      );
    this.plans.set(id, plan);
    this.planVolumeIdentities.set(id, currentVolumeIdentity);
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
      kind: "copy",
      destination,
      expectedHash: prepared.record.expectedHash,
      ...(prepared.rollback ? { rollback: prepared.rollback } : {}),
    };
  }

  private async quarantineRemoval(
    runId: string,
    targetPath: string,
    item: SyncPlanDto["removals"][number],
  ): Promise<InstalledRemoval> {
    const destination = await safeRecordedPath(
      targetPath,
      item.relativeDestination,
    );
    if ((await streamingFileHash(destination)) !== item.expectedTargetHash)
      throw new Error(
        "Manifest-owned target changed after preview; create a new plan.",
      );
    const quarantine = `${destination}.outgroove-${randomUUID()}.quarantine`;
    const record = this.database.addSyncRunChange(runId, {
      kind: "removal",
      relativeDestination: recordedRelativePath(targetPath, destination),
      temporaryRelative: recordedRelativePath(targetPath, quarantine),
      rollbackRelative: null,
      expectedHash: item.expectedTargetHash,
    });
    await rename(destination, quarantine);
    try {
      if ((await streamingFileHash(quarantine)) !== item.expectedTargetHash)
        throw new Error(
          "Manifest-owned target changed while it was being quarantined.",
        );
    } catch (error) {
      await rename(quarantine, destination);
      throw error;
    }
    this.database.markSyncRunChangeInstalled(runId, record.id);
    return {
      kind: "removal",
      destination,
      quarantine,
      expectedHash: item.expectedTargetHash,
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
          const internalPath = await safeRecordedPath(
            run.targetPath,
            relativePath,
          );
          if (
            change.kind === "removal" &&
            relativePath === change.temporaryRelative &&
            (await pathExists(internalPath)) &&
            (await streamingFileHash(internalPath)) !== change.expectedHash
          )
            throw new Error(
              "Removal quarantine changed externally and was left untouched.",
            );
          await unlinkIfExists(internalPath);
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
    const profile = this.database.getSyncProfile(run.profileId);
    let targetVolumeStatus: SyncPlanDto["targetVolume"]["status"] =
      "unavailable";
    let currentVolumeIdentity: string | null = null;
    try {
      const evidence = await this.inspectTarget(run.targetPath);
      currentVolumeIdentity = evidence.volumeIdentity;
      targetVolumeStatus =
        evidence.volumeIdentity === null
          ? "unavailable"
          : profile?.target_volume_identity === null
            ? "unrecorded"
            : evidence.volumeIdentity === profile?.target_volume_identity
              ? "matched"
              : "changed";
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
          if (change.kind === "removal") {
            const quarantineExists = await pathExists(temporary);
            const destinationExists = await pathExists(destination);
            if (run.state === "committed-cleanup") {
              if (quarantineExists)
                actions.push({
                  path: temporary,
                  action: "remove",
                  explanation:
                    "Remove the quarantined manifest-owned file after the new manifest committed.",
                });
              continue;
            }
            if (quarantineExists && !destinationExists)
              actions.push({
                path: destination,
                action: "restore",
                explanation:
                  "Restore the manifest-owned file from Outgroove’s removal quarantine.",
              });
            else if (quarantineExists)
              warnings.push(
                `${destination} appeared after the interrupted removal. It will remain untouched; the owned file remains recoverable at ${temporary}.`,
              );
            else if (!destinationExists) {
              canRecover = false;
              warnings.push(
                `${destination} and its removal quarantine are both missing. Recovery cannot prove the owned file is safe.`,
              );
            }
            continue;
          }
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
      currentVolumeIdentity,
      targetVolumeStatus,
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
      targetVolume: {
        status: targetVolumeStatus,
        confirmationRequired: targetVolumeStatus !== "matched",
      },
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
    if (change.kind === "removal") {
      const quarantineExists = await pathExists(temporary);
      const destinationExists = await pathExists(destination);
      if (run.state === "committed-cleanup") {
        if (!quarantineExists) return { recovered: 0, notes };
        if ((await streamingFileHash(temporary)) !== change.expectedHash) {
          notes.push(`${temporary} changed externally and was left untouched.`);
          throw new Error("Removal quarantine changed externally.");
        }
        await unlink(temporary);
        return { recovered: 0, notes };
      }
      if (!quarantineExists) {
        if (
          destinationExists &&
          (await streamingFileHash(destination)) === change.expectedHash
        )
          return { recovered: 0, notes };
        throw new Error(
          "Manifest-owned file and its valid removal quarantine are unavailable.",
        );
      }
      if ((await streamingFileHash(temporary)) !== change.expectedHash)
        throw new Error("Removal quarantine changed externally.");
      if (destinationExists) {
        notes.push(
          `${destination} appeared externally and was left untouched. The owned file remains at ${temporary}.`,
        );
        throw new Error("Removal destination is no longer empty.");
      }
      await rename(temporary, destination);
      return { recovered: 1, notes };
    }
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
    targetVolumeConfirmed = false,
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
    if (preview.targetVolume.confirmationRequired && !targetVolumeConfirmed)
      throw new Error(
        "Confirm the uncertain DAP volume identity before applying recovery.",
      );
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
    installed: readonly InstalledChange[],
  ): Promise<{ rolledBack: number; errors: string[] }> {
    let rolledBack = 0;
    const errors: string[] = [];
    for (const change of [...installed].reverse()) {
      if (change.kind === "removal") {
        try {
          if (
            (await streamingFileHash(change.quarantine)) !== change.expectedHash
          )
            throw new Error("removal quarantine changed externally");
          if (await pathExists(change.destination))
            throw new Error(
              "an unknown target file appeared at the removal destination",
            );
          await rename(change.quarantine, change.destination);
          rolledBack++;
        } catch (error) {
          errors.push(
            `${change.destination}: removal rollback failed because ${error instanceof Error ? error.message : String(error)}. The owned file remains recoverable at ${change.quarantine}.`,
          );
        }
        continue;
      }
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

  private async validatePlanState(plan: SyncPlanDto): Promise<void> {
    const profile = this.database.getSyncProfile(plan.profileId);
    if (profile?.target_path !== plan.targetPath)
      throw new Error(
        "The DAP profile target changed after preview; create a new plan.",
      );
    const currentEvidence = await this.inspectTarget(plan.targetPath);
    if (currentEvidence.rootIdentity !== plan.targetIdentity)
      throw new Error(
        "The DAP target changed after preview; reconnect the reviewed target and create a new plan.",
      );
    if (
      !this.planVolumeIdentities.has(plan.id) ||
      currentEvidence.volumeIdentity !== this.planVolumeIdentities.get(plan.id)
    )
      throw new Error(
        "The DAP volume identity changed after preview; create a new plan.",
      );
    const previous = this.database.getLatestManifest(
      plan.profileId,
      plan.targetPath,
    );
    if (manifestHash(previous?.manifest_json) !== plan.previousManifestHash)
      throw new Error(
        "The ownership manifest changed after preview; create a new plan.",
      );
    if (previous) {
      const databaseManifest = parseManifest(previous.manifest_json);
      const targetManifestPath = await safeRecordedPath(
        plan.targetPath,
        join(".outgroove", "manifest.json"),
      );
      const targetManifest = parseManifest(
        await readFile(targetManifestPath, "utf8"),
      );
      if (JSON.stringify(targetManifest) !== JSON.stringify(databaseManifest))
        throw new Error(
          "The target manifest changed after preview; create a new plan.",
        );
    }
    for (const item of [
      ...plan.copies,
      ...plan.replacements,
      ...plan.unchanged,
    ]) {
      const sourceInfo = await stat(item.sourcePath);
      if (
        `${sourceInfo.size}:${Math.trunc(sourceInfo.mtimeMs)}` !==
        item.signature
      )
        throw new Error(
          `${item.relativeDestination}: source changed after preview; create a new plan.`,
        );
      const destination = await safeRecordedPath(
        plan.targetPath,
        item.relativeDestination,
      );
      if (item.expectedTargetHash) {
        if (
          !(await pathExists(destination)) ||
          (await streamingFileHash(destination)) !== item.expectedTargetHash
        )
          throw new Error(
            `${item.relativeDestination}: target changed after preview; create a new plan.`,
          );
      } else if (await pathExists(destination))
        throw new Error(
          `${item.relativeDestination}: an unknown target file appeared after preview.`,
        );
    }
    for (const item of plan.removals) {
      const destination = await safeRecordedPath(
        plan.targetPath,
        item.relativeDestination,
      );
      if (
        !(await pathExists(destination)) ||
        (await streamingFileHash(destination)) !== item.expectedTargetHash
      )
        throw new Error(
          `${item.relativeDestination}: manifest-owned target changed after preview; create a new plan.`,
        );
    }
    for (const relativeDestination of plan.absentOwned)
      if (
        await pathExists(
          await safeRecordedPath(plan.targetPath, relativeDestination),
        )
      )
        throw new Error(
          `${relativeDestination}: a target file appeared after preview; create a new plan.`,
        );
  }

  async apply(
    planId: string,
    confirmationToken: string,
    onProgress: (completed: number, total: number, path: string) => void = () =>
      undefined,
    targetVolumeConfirmed = false,
  ): Promise<SyncApplyResultDto> {
    const plan = this.plans.get(planId);
    if (plan?.confirmationToken !== confirmationToken)
      throw new Error("Sync must be applied from its current preview.");
    if (plan.conflicts.length > 0 || plan.errors.length > 0)
      throw new Error("Resolve sync conflicts and errors before applying.");
    if (!plan.hasChanges)
      throw new Error("This sync plan has no changes to apply.");
    if (plan.targetVolume.confirmationRequired && !targetVolumeConfirmed)
      throw new Error(
        "Confirm the uncertain DAP volume identity before applying this plan.",
      );
    if (plan.removals.length > 0 && !plan.cleanupEnabled)
      throw new Error("Cleanup was not enabled for this sync plan.");
    if (this.applyingProfiles.has(plan.profileId))
      throw new Error("A sync is already applying for this profile.");
    await this.validatePlanState(plan);
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
      const installed: InstalledChange[] = [];
      const replacementDestinations = new Set(
        plan.replacements.map((item) =>
          item.relativeDestination.normalize("NFC").toLocaleLowerCase("en-US"),
        ),
      );
      const plannedCopies = [...plan.copies, ...plan.replacements];
      let copied = 0;
      let replaced = 0;
      let removed = 0;
      let cancelled = false;
      let cleanupFailed = false;
      for (const item of plannedCopies) {
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
          await safeRecordedPath(
            plan.targetPath,
            recordedRelativePath(plan.targetPath, destination.absolute),
          );
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
          const replacesExisting = replacementDestinations.has(comparisonKey);
          if (
            replacesExisting &&
            (!item.expectedTargetHash ||
              (await streamingFileHash(destination.absolute)) !==
                item.expectedTargetHash)
          )
            throw new Error(
              "Manifest-owned target changed after preview; create a new plan.",
            );
          const prepared = this.recordChange(
            run.id,
            plan.targetPath,
            "copy",
            destination.absolute,
            sourceHash,
            replacesExisting,
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
          if (replacesExisting) {
            if (!prepared.rollback)
              throw new Error("Owned replacement recovery path is missing.");
            await rename(destination.absolute, prepared.rollback);
            try {
              if (
                !item.expectedTargetHash ||
                (await streamingFileHash(prepared.rollback)) !==
                  item.expectedTargetHash
              )
                throw new Error(
                  "Manifest-owned target changed while replacement was starting.",
                );
              await rename(temporary, destination.absolute);
              temporary = undefined;
            } catch (error) {
              await rename(prepared.rollback, destination.absolute);
              throw error;
            }
            installed.push({
              kind: "copy",
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
                kind: "copy",
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
                kind: "copy",
                destination: destination.absolute,
                expectedHash: temporaryHash,
              });
            await unlinkIfExists(temporary);
            temporary = undefined;
          }
          this.database.markSyncRunChangeInstalled(run.id, prepared.record.id);
          if (replacesExisting) replaced++;
          else copied++;
          onProgress(
            copied + replaced + removed,
            plannedCopies.length + plan.removals.length,
            item.relativeDestination,
          );
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
      if (!cancelled && errors.length === 0)
        for (const item of plan.removals) {
          if (cancellationRequested(active.controller.signal)) {
            cancelled = true;
            break;
          }
          try {
            await this.hooks.beforeRemoval?.(item);
            if (cancellationRequested(active.controller.signal)) {
              cancelled = true;
              break;
            }
            installed.push(
              await this.quarantineRemoval(run.id, plan.targetPath, item),
            );
            removed++;
            onProgress(
              copied + replaced + removed,
              plannedCopies.length + plan.removals.length,
              item.relativeDestination,
            );
            await this.hooks.afterRemovalQuarantined?.(item);
          } catch (error) {
            errors.push(
              `${item.relativeDestination}: ${error instanceof Error ? error.message : String(error)}`,
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
          replaced,
          removed,
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
        const allItems = [
          ...plan.copies,
          ...plan.replacements,
          ...plan.unchanged,
        ].sort((left, right) =>
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
        this.deletePlan(planId);
        errors.push(
          ...(await this.cleanupCommittedRun(
            this.database.getSyncRun(run.id) ?? run,
          )),
        );
      }
      return {
        outcome: "completed",
        copied,
        replaced,
        removed,
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
