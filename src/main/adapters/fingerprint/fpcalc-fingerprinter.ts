import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";

import { z } from "zod";

const fpcalcResultSchema = z
  .object({
    duration: z
      .number()
      .positive()
      .max(24 * 60 * 60),
    fingerprint: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .min(1)
      .max(100_000),
  })
  .strict();

export interface AudioFingerprint {
  readonly durationSeconds: number;
  readonly value: string;
  readonly sourceSize: number;
  readonly sourceModifiedMs: number;
}

export interface FingerprintRunner {
  run(
    executablePath: string,
    audioPath: string,
    signal: AbortSignal,
  ): Promise<string>;
}

class NodeFingerprintRunner implements FingerprintRunner {
  run(
    executablePath: string,
    audioPath: string,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        executablePath,
        ["-json", audioPath],
        {
          encoding: "utf8",
          maxBuffer: 2_000_000,
          signal,
          timeout: 120_000,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            reject(
              signal.aborted
                ? new Error("Fingerprinting was cancelled.")
                : new Error(
                    "Chromaprint could not fingerprint this audio file.",
                  ),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}

export class FpcalcFingerprinter {
  constructor(
    private readonly executablePath: string | undefined,
    private readonly runner: FingerprintRunner = new NodeFingerprintRunner(),
  ) {}

  async fingerprint(
    audioPath: string,
    signal: AbortSignal,
  ): Promise<AudioFingerprint> {
    if (!this.executablePath)
      throw new Error(
        "Chromaprint is unavailable for this operating system and architecture.",
      );
    try {
      await access(this.executablePath, constants.X_OK);
    } catch {
      throw new Error("The bundled Chromaprint helper is unavailable.");
    }
    const before = await this.inspect(audioPath);
    const output = await this.runner.run(
      this.executablePath,
      audioPath,
      signal,
    );
    const after = await this.inspect(audioPath);
    if (before.size !== after.size || before.modifiedMs !== after.modifiedMs)
      throw new Error(
        "The audio file changed while Chromaprint was reading it. Rescan and retry.",
      );
    let payload: unknown;
    try {
      payload = JSON.parse(output) as unknown;
    } catch {
      throw new Error("Chromaprint returned an unreadable fingerprint.");
    }
    const parsed = fpcalcResultSchema.safeParse(payload);
    if (!parsed.success)
      throw new Error("Chromaprint returned an invalid fingerprint.");
    return {
      durationSeconds: Math.round(parsed.data.duration),
      value: parsed.data.fingerprint,
      sourceSize: after.size,
      sourceModifiedMs: after.modifiedMs,
    };
  }

  async inspect(audioPath: string): Promise<{
    readonly size: number;
    readonly modifiedMs: number;
  }> {
    try {
      const metadata = await stat(audioPath);
      if (!metadata.isFile()) throw new Error("not a file");
      return { size: metadata.size, modifiedMs: metadata.mtimeMs };
    } catch {
      throw new Error("The selected audio file is no longer readable.");
    }
  }
}
