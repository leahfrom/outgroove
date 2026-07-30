import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import type { DiagnosticReportExportResultDto } from "../../shared/contracts/api";
import type { CatalogDatabase } from "../adapters/database/catalog-database";

export interface DiagnosticEnvironment {
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly runtimeVersions: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
}

export interface DiagnosticReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly application: {
    readonly name: "Outgroove";
    readonly version: string;
    readonly packaged: boolean;
  };
  readonly system: {
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
  readonly database: {
    readonly schemaVersion: number;
    readonly integrity: "ok" | "issues-detected";
    readonly counts: {
      readonly watchedLibraryRoots: number;
      readonly audioFiles: number;
      readonly availableAudioFiles: number;
      readonly missingAudioFiles: number;
      readonly scanErrorFiles: number;
      readonly directoryScanErrors: number;
      readonly albums: number;
      readonly tracks: number;
      readonly editOperations: number;
      readonly scanJobs: number;
      readonly syncProfiles: number;
      readonly pendingSyncRecoveries: number;
      readonly savedLibraryFilters: number;
      readonly favoriteArtists: number;
      readonly radarItems: number;
      readonly providerCacheEntries: number;
    };
  };
  readonly privacy: {
    readonly paths: "redacted";
    readonly filenames: "excluded";
    readonly tags: "excluded";
    readonly providerPayloads: "excluded";
    readonly stableIdentifiers: "excluded";
    readonly errorMessages: "excluded";
  };
}

export interface DiagnosticReportExportHooks {
  readonly afterPublish?: (destinationPath: string) => Promise<void>;
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function renameIfExists(
  source: string,
  destination: string,
): Promise<boolean> {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function flush(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class ExportDiagnosticReport {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly environment: DiagnosticEnvironment,
    private readonly now: () => Date = () => new Date(),
    private readonly hooks: DiagnosticReportExportHooks = {},
  ) {}

  createReport(): DiagnosticReport {
    const count = (sql: string): number =>
      this.database.connection.prepare(sql).pluck().get() as number;
    const snapshot = this.database.connection.transaction(() => {
      const integrity =
        this.database.connection.pragma("quick_check", { simple: true }) ===
        "ok"
          ? "ok"
          : "issues-detected";
      return {
        schemaVersion: this.database.connection.pragma("user_version", {
          simple: true,
        }) as number,
        integrity,
        counts: {
          watchedLibraryRoots: count(
            "SELECT COUNT(*) FROM library_roots WHERE removed_at IS NULL",
          ),
          audioFiles: count("SELECT COUNT(*) FROM audio_files"),
          availableAudioFiles: count(
            "SELECT COUNT(*) FROM audio_files WHERE scan_state='ok'",
          ),
          missingAudioFiles: count(
            "SELECT COUNT(*) FROM audio_files WHERE scan_state='missing'",
          ),
          scanErrorFiles: count(
            "SELECT COUNT(*) FROM audio_files WHERE scan_state='error'",
          ),
          directoryScanErrors: count(
            "SELECT COUNT(*) FROM scan_directory_errors",
          ),
          albums: count("SELECT COUNT(*) FROM albums"),
          tracks: count("SELECT COUNT(*) FROM tracks"),
          editOperations: count("SELECT COUNT(*) FROM edit_operations"),
          scanJobs: count("SELECT COUNT(*) FROM jobs"),
          syncProfiles: count("SELECT COUNT(*) FROM sync_profiles"),
          pendingSyncRecoveries: count("SELECT COUNT(*) FROM sync_runs"),
          savedLibraryFilters: count(
            "SELECT COUNT(*) FROM saved_library_filters",
          ),
          favoriteArtists: count("SELECT COUNT(*) FROM favorite_artists"),
          radarItems: count("SELECT COUNT(*) FROM radar_items"),
          providerCacheEntries: count("SELECT COUNT(*) FROM provider_cache"),
        },
      } as const;
    })();

    return {
      schemaVersion: 1,
      generatedAt: this.now().toISOString(),
      application: {
        name: "Outgroove",
        version: this.environment.appVersion,
        packaged: this.environment.packaged,
      },
      system: {
        platform: this.environment.platform,
        architecture: this.environment.architecture,
        electron: this.environment.runtimeVersions.electron,
        chrome: this.environment.runtimeVersions.chrome,
        node: this.environment.runtimeVersions.node,
      },
      database: snapshot,
      privacy: {
        paths: "redacted",
        filenames: "excluded",
        tags: "excluded",
        providerPayloads: "excluded",
        stableIdentifiers: "excluded",
        errorMessages: "excluded",
      },
    };
  }

  async exportTo(
    destinationPath: string,
  ): Promise<DiagnosticReportExportResultDto> {
    if (!isAbsolute(destinationPath))
      throw new Error("Diagnostic report destination must be absolute.");
    const contents = `${JSON.stringify(this.createReport(), null, 2)}\n`;
    const expected = createHash("sha256").update(contents).digest("hex");
    const temporary = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.outgroove-${randomUUID()}.tmp`,
    );
    const previous = `${temporary}.previous`;
    let movedPrevious = false;
    let published = false;
    try {
      await writeFile(temporary, contents, {
        encoding: "utf8",
        flag: "wx",
      });
      await flush(temporary);
      movedPrevious = await renameIfExists(destinationPath, previous);
      await rename(temporary, destinationPath);
      published = true;
      await this.hooks.afterPublish?.(destinationPath);
      const verified = await readFile(destinationPath);
      const actual = createHash("sha256").update(verified).digest("hex");
      if (actual !== expected)
        throw new Error("Diagnostic report failed post-write verification.");
      if (movedPrevious) await unlinkIfExists(previous);
      return {
        path: destinationPath,
        byteLength: verified.byteLength,
        sha256: actual,
      };
    } catch (error) {
      await unlinkIfExists(temporary);
      if (published) await unlinkIfExists(destinationPath);
      if (movedPrevious) await rename(previous, destinationPath);
      throw error;
    }
  }
}
