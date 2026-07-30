import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, parse, win32 } from "node:path";

export interface TargetFilesystemEvidence {
  readonly rootIdentity: string;
  readonly volumeIdentity: string | null;
}

export interface PersistentVolumeProbe {
  inspect(
    platform: NodeJS.Platform,
    targetRoot: string,
    volumeRoot: string,
  ): Promise<string | null>;
}

interface CommandResult {
  readonly stdout: string;
}

export interface VolumeCommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: {
      readonly env?: NodeJS.ProcessEnv;
    },
  ): Promise<CommandResult>;
}

class FixedVolumeCommandRunner implements VolumeCommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: {
      readonly env?: NodeJS.ProcessEnv;
    },
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        [...args],
        {
          encoding: "utf8",
          env: options?.env,
          maxBuffer: 64 * 1024,
          timeout: 5_000,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("The volume identity helper failed."),
            );
            return;
          }
          resolve({ stdout });
        },
      );
    });
  }
}

function persistentIdentity(platform: NodeJS.Platform, value: string): string {
  return `persistent-volume:${platform}:${createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function plistString(source: string, key: string): string | null {
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `<key>${escapedKey}</key>\\s*<string>([^<]*)</string>`,
    "u",
  ).exec(source);
  const value = match?.[1]?.trim();
  return value?.length ? value : null;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export class SystemPersistentVolumeProbe implements PersistentVolumeProbe {
  constructor(
    private readonly runner: VolumeCommandRunner = new FixedVolumeCommandRunner(),
  ) {}

  async inspect(
    platform: NodeJS.Platform,
    targetRoot: string,
    volumeRoot: string,
  ): Promise<string | null> {
    try {
      if (platform === "darwin") {
        const { stdout } = await this.runner.run("/usr/sbin/diskutil", [
          "info",
          "-plist",
          volumeRoot,
        ]);
        const uuid = plistString(stdout, "VolumeUUID");
        return uuid &&
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(uuid)
          ? persistentIdentity(platform, uuid.toLowerCase())
          : null;
      }
      if (platform === "win32") {
        const systemRoot = process.env.SystemRoot;
        if (!systemRoot || !win32.isAbsolute(systemRoot)) return null;
        const executable = win32.join(
          systemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        );
        const { stdout } = await this.runner.run(
          executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$volume = Get-Volume -FilePath $env:OUTGROOVE_TARGET_PATH -ErrorAction Stop; [Console]::Out.Write($volume.UniqueId)",
          ],
          {
            env: {
              ...process.env,
              OUTGROOVE_TARGET_PATH: targetRoot,
            },
          },
        );
        const uniqueId = stdout.trim();
        return uniqueId.length > 0 &&
          uniqueId.length <= 512 &&
          !containsControlCharacter(uniqueId)
          ? persistentIdentity(platform, uniqueId)
          : null;
      }
    } catch {
      // Native identity is additional evidence. An unavailable helper or
      // unsupported volume must fall back to explicit user confirmation.
    }
    return null;
  }
}

async function findVolumeRoot(
  targetRoot: string,
  device: number,
): Promise<string> {
  let current = await realpath(targetRoot);
  for (;;) {
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return current;
    const parentInfo = await lstat(parent);
    if (parentInfo.dev !== device) return current;
    current = parent;
  }
}

export async function inspectTargetFilesystem(
  targetRoot: string,
  probe: PersistentVolumeProbe = new SystemPersistentVolumeProbe(),
  platform: NodeJS.Platform = process.platform,
): Promise<TargetFilesystemEvidence> {
  const info = await lstat(targetRoot);
  if (info.isSymbolicLink())
    throw new Error("Refusing a symbolic link as the DAP target.");
  if (!info.isDirectory())
    throw new Error("The DAP target is not a directory.");

  const volumeRoot = await findVolumeRoot(targetRoot, info.dev);
  return {
    rootIdentity: `${info.dev}:${info.ino}`,
    volumeIdentity: await probe.inspect(platform, targetRoot, volumeRoot),
  };
}
