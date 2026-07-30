import { lstat } from "node:fs/promises";

export interface TargetFilesystemEvidence {
  readonly rootIdentity: string;
  readonly volumeIdentity: string | null;
}

export async function inspectTargetFilesystem(
  targetRoot: string,
): Promise<TargetFilesystemEvidence> {
  const info = await lstat(targetRoot);
  if (info.isSymbolicLink())
    throw new Error("Refusing a symbolic link as the DAP target.");
  if (!info.isDirectory())
    throw new Error("The DAP target is not a directory.");

  return {
    rootIdentity: `${info.dev}:${info.ino}`,
    // Node exposes the mounted filesystem's device identifier on platforms
    // where the operating system provides one. Zero is not useful evidence
    // and must remain an explicitly confirmed ambiguity.
    volumeIdentity:
      Number.isSafeInteger(info.dev) && info.dev > 0
        ? `filesystem-device:${info.dev}`
        : null,
  };
}
