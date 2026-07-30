import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inspectTargetFilesystem,
  type PersistentVolumeProbe,
  SystemPersistentVolumeProbe,
  type VolumeCommandRunner,
} from "./target-volume";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("target filesystem evidence", () => {
  it("returns deterministic root and persistent volume evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-volume-"));
    temporary.push(directory);
    const target = join(directory, "target");
    await mkdir(target);
    const inspect = vi.fn<PersistentVolumeProbe["inspect"]>(() =>
      Promise.resolve("persistent-volume:test:fixture"),
    );
    const probe: PersistentVolumeProbe = {
      inspect,
    };

    const first = await inspectTargetFilesystem(target, probe, "linux");
    await expect(
      inspectTargetFilesystem(target, probe, "linux"),
    ).resolves.toEqual(first);
    expect(first.rootIdentity).toMatch(/^\d+:\d+$/u);
    expect(first.volumeIdentity).toBe("persistent-volume:test:fixture");
    expect(inspect).toHaveBeenCalledWith("linux", target, expect.any(String));
  });

  it("refuses files and symbolic-link roots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-volume-"));
    temporary.push(directory);
    const target = join(directory, "target");
    const file = join(directory, "file");
    const linked = join(directory, "linked");
    await mkdir(target);
    await writeFile(file, "fixture");
    await symlink(target, linked, "dir");

    await expect(inspectTargetFilesystem(file)).rejects.toThrow(
      "not a directory",
    );
    await expect(inspectTargetFilesystem(linked)).rejects.toThrow(
      "symbolic link",
    );
  });

  it("hashes a validated macOS volume UUID from a fixed diskutil command", async () => {
    const run = vi.fn<VolumeCommandRunner["run"]>(() =>
      Promise.resolve({
        stdout: `<plist><dict>
          <key>VolumeUUID</key>
          <string>01234567-89AB-CDEF-0123-456789ABCDEF</string>
        </dict></plist>`,
      }),
    );
    const runner: VolumeCommandRunner = {
      run,
    };
    const probe = new SystemPersistentVolumeProbe(runner);

    const identity = await probe.inspect("darwin", "/target", "/Volumes/DAP");

    expect(identity).toMatch(/^persistent-volume:darwin:[0-9a-f]{64}$/u);
    expect(run).toHaveBeenCalledWith("/usr/sbin/diskutil", [
      "info",
      "-plist",
      "/Volumes/DAP",
    ]);
    expect(identity).not.toContain("01234567");
  });

  it("passes a Windows target only through the environment and hashes UniqueId", async () => {
    const previousSystemRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
    const run = vi.fn<VolumeCommandRunner["run"]>(() =>
      Promise.resolve({
        stdout: "\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\",
      }),
    );
    const runner: VolumeCommandRunner = {
      run,
    };
    const probe = new SystemPersistentVolumeProbe(runner);
    try {
      const identity = await probe.inspect("win32", "E:\\Music target", "E:\\");

      expect(identity).toMatch(/^persistent-volume:win32:[0-9a-f]{64}$/u);
      expect(run).toHaveBeenCalledWith(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        expect.any(Array),
        expect.any(Object),
      );
      const invocation = run.mock.calls[0];
      expect(invocation?.[1]).not.toContain("E:\\Music target");
      expect(invocation?.[2]?.env?.OUTGROOVE_TARGET_PATH).toBe(
        "E:\\Music target",
      );
      expect(identity).not.toContain("Volume");
    } finally {
      if (previousSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = previousSystemRoot;
    }
  });

  it("returns ambiguity for unavailable helpers and malformed native output", async () => {
    const failing = new SystemPersistentVolumeProbe({
      run: vi.fn(() => Promise.reject(new Error("helper unavailable"))),
    });
    const malformed = new SystemPersistentVolumeProbe({
      run: vi.fn(() =>
        Promise.resolve({
          stdout: "<key>VolumeUUID</key><string>x</string>",
        }),
      ),
    });

    await expect(failing.inspect("darwin", "/target", "/")).resolves.toBeNull();
    await expect(
      malformed.inspect("darwin", "/target", "/"),
    ).resolves.toBeNull();
    await expect(failing.inspect("linux", "/target", "/")).resolves.toBeNull();
  });
});
