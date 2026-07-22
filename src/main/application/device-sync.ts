import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  open,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  SyncApplyResultDto,
  SyncPlanDto,
  SyncPlanItemDto,
  SyncProfileDto,
} from "../../shared/contracts/api";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
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
  beforeManifest?: () => Promise<void>;
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

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.outgroove-${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  await flushFile(temporary);
  const rollback = `${path}.outgroove-${randomUUID()}.rollback`;
  let hadExisting = false;
  try {
    await rename(path, rollback);
    hadExisting = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    if (hadExisting) await rename(rollback, path);
    throw error;
  }
  if (hadExisting) await unlinkIfExists(rollback);
}

function deterministicUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const versioned = `${hash.slice(0, 12)}4${hash.slice(13, 16)}8${hash.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
}

export class DeviceSync {
  private readonly plans = new Map<string, SyncPlanDto>();
  private readonly profileRevisions = new Map<string, number>();
  private readonly applyingProfiles = new Set<string>();

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
    this.applyingProfiles.add(plan.profileId);
    try {
      const errors: string[] = [];
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
      for (const item of plan.copies) {
        let temporary: string | undefined;
        try {
          await this.hooks.beforeCopy?.(item);
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
          await mkdir(dirname(destination.absolute), { recursive: true });
          temporary = `${destination.absolute}.outgroove-${randomUUID()}.tmp`;
          const rollback = `${destination.absolute}.outgroove-${randomUUID()}.rollback`;
          await copyFile(item.sourcePath, temporary);
          await flushFile(temporary);
          if (
            (await streamingFileHash(item.sourcePath)) !==
            (await streamingFileHash(temporary))
          )
            throw new Error("Copied file verification failed.");
          const sourceAfterCopy = await stat(item.sourcePath);
          if (
            `${sourceAfterCopy.size}:${Math.trunc(sourceAfterCopy.mtimeMs)}` !==
            item.signature
          )
            throw new Error("Source changed during copy; create a new plan.");
          const comparisonKey = item.relativeDestination
            .normalize("NFC")
            .toLocaleLowerCase("en-US");
          if (ownedDestinations.has(comparisonKey)) {
            await rename(destination.absolute, rollback);
            try {
              await rename(temporary, destination.absolute);
              temporary = undefined;
            } catch (error) {
              await rename(rollback, destination.absolute);
              throw error;
            }
            await unlinkIfExists(rollback);
          } else {
            // Atomically refuse to clobber a file created after the preview.
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
              if (
                (await streamingFileHash(destination.absolute)) !==
                (await streamingFileHash(temporary))
              )
                throw new Error("Exclusive target copy verification failed.");
            }
            await unlinkIfExists(temporary);
            temporary = undefined;
          }
          copied++;
          onProgress(copied, plan.copies.length, item.relativeDestination);
        } catch (error) {
          if (temporary) await unlinkIfExists(temporary);
          errors.push(
            `${item.relativeDestination}: ${error instanceof Error ? error.message : String(error)}`,
          );
          break;
        }
      }
      const playlistPath = join(plan.targetPath, "Outgroove.m3u8");
      const manifestPath = join(plan.targetPath, ".outgroove", "manifest.json");
      if (errors.length === 0) {
        const allItems = [...plan.copies, ...plan.unchanged].sort(
          (left, right) =>
            left.relativeDestination.localeCompare(right.relativeDestination),
        );
        await atomicWrite(
          playlistPath,
          `#EXTM3U\n${allItems.map((item) => item.relativeDestination.split("\\").join("/")).join("\n")}\n`,
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
        await atomicWrite(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
        this.database.saveManifest(plan.profileId, plan.targetPath, manifest);
        this.plans.delete(planId);
      }
      return {
        copied,
        unchanged: plan.unchanged.length,
        playlistPath,
        manifestPath,
        errors,
      };
    } finally {
      this.applyingProfiles.delete(plan.profileId);
    }
  }
}
