import type { ForgeMakeResult } from "@electron-forge/shared-types";
import { describe, expect, it, vi } from "vitest";

import {
  finalizeMacDmgArtifacts,
  macDmgCodeSignArguments,
  resolveMacReleaseConfig,
} from "../../scripts/macos-release";

const makeResult = (
  platform: ForgeMakeResult["platform"],
  artifacts: string[],
): ForgeMakeResult => ({
  platform,
  artifacts,
  arch: platform === "darwin" ? "arm64" : "x64",
  packageJSON: {},
});

describe("macOS release configuration", () => {
  it("keeps ordinary local packaging unsigned and credential-free", () => {
    expect(resolveMacReleaseConfig({})).toEqual({ signingEnabled: false });
  });

  it("requires an explicit Developer ID identity when signing is enabled", () => {
    expect(() =>
      resolveMacReleaseConfig({ OUTGROOVE_MAC_SIGNING: "1" }),
    ).toThrow(/requires OUTGROOVE_MAC_SIGNING_IDENTITY/u);
  });

  it("accepts one complete API-key credential set for signed CI builds", () => {
    expect(
      resolveMacReleaseConfig({
        OUTGROOVE_MAC_SIGNING: "1",
        OUTGROOVE_MAC_SIGNING_IDENTITY:
          "Developer ID Application: Fixture (ABCDEFGHIJ)",
        OUTGROOVE_MAC_NOTARY_API_KEY_PATH: "/tmp/AuthKey_FIXTURE.p8",
        OUTGROOVE_MAC_NOTARY_API_KEY_ID: "FIXTURE123",
        OUTGROOVE_MAC_NOTARY_API_ISSUER: "11111111-2222-4333-8444-555555555555",
      }),
    ).toEqual({
      signingEnabled: true,
      signingIdentity: "Developer ID Application: Fixture (ABCDEFGHIJ)",
      notarizationCredentials: {
        appleApiKey: "/tmp/AuthKey_FIXTURE.p8",
        appleApiKeyId: "FIXTURE123",
        appleApiIssuer: "11111111-2222-4333-8444-555555555555",
      },
    });
  });

  it("rejects partial, ambiguous, or unsigned notarization credentials", () => {
    expect(() =>
      resolveMacReleaseConfig({
        OUTGROOVE_MAC_NOTARY_API_KEY_ID: "FIXTURE123",
      }),
    ).toThrow(/requires key path, key ID, and issuer/u);

    expect(() =>
      resolveMacReleaseConfig({
        OUTGROOVE_MAC_SIGNING: "1",
        OUTGROOVE_MAC_SIGNING_IDENTITY:
          "Developer ID Application: Fixture (ABCDEFGHIJ)",
        OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE: "fixture",
        OUTGROOVE_MAC_NOTARY_API_KEY_PATH: "/tmp/AuthKey_FIXTURE.p8",
        OUTGROOVE_MAC_NOTARY_API_KEY_ID: "FIXTURE123",
        OUTGROOVE_MAC_NOTARY_API_ISSUER: "11111111-2222-4333-8444-555555555555",
      }),
    ).toThrow(/either.*keychain profile or API-key credentials/iu);

    expect(() =>
      resolveMacReleaseConfig({
        OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE: "fixture",
      }),
    ).toThrow(/require OUTGROOVE_MAC_SIGNING=1/u);
  });
});

describe("macOS DMG notarization", () => {
  const releaseConfig = {
    signingEnabled: true,
    signingIdentity: "Developer ID Application: Fixture (ABCDEFGHIJ)",
    notarizationCredentials: { keychainProfile: "outgroove-notary" },
  } as const;

  it("uses the Developer ID identity, a separate identifier, and a secure timestamp", () => {
    expect(
      macDmgCodeSignArguments(
        "Developer ID Application: Fixture (ABCDEFGHIJ)",
        "/tmp/outgroove.dmg",
      ),
    ).toEqual([
      "--sign",
      "Developer ID Application: Fixture (ABCDEFGHIJ)",
      "--timestamp",
      "--identifier",
      "de.leahfrom.outgroove.dmg",
      "/tmp/outgroove.dmg",
    ]);
  });

  it("signs, then submits and staples only final Darwin DMG artifacts", async () => {
    const events: string[] = [];
    const signArtifact = vi.fn((path: string) => {
      events.push(`sign:${path}`);
      return Promise.resolve();
    });
    const notarizeArtifact = vi.fn(({ appPath }: { appPath: string }) => {
      events.push(`notarize:${appPath}`);
      return Promise.resolve();
    });

    await finalizeMacDmgArtifacts(
      [
        makeResult("darwin", ["/tmp/outgroove.zip", "/tmp/Outgroove.DMG"]),
        makeResult("win32", ["/tmp/not-a-mac.dmg"]),
      ],
      releaseConfig,
      signArtifact,
      notarizeArtifact,
    );

    expect(signArtifact).toHaveBeenCalledWith(
      "/tmp/Outgroove.DMG",
      "Developer ID Application: Fixture (ABCDEFGHIJ)",
    );
    expect(notarizeArtifact).toHaveBeenCalledOnce();
    expect(notarizeArtifact).toHaveBeenCalledWith({
      appPath: "/tmp/Outgroove.DMG",
      keychainProfile: "outgroove-notary",
    });
    expect(events).toEqual([
      "sign:/tmp/Outgroove.DMG",
      "notarize:/tmp/Outgroove.DMG",
    ]);
  });

  it("does no network work for unsigned packaging", async () => {
    const signArtifact = vi.fn(() => Promise.resolve());
    const notarizeArtifact = vi.fn(() => Promise.resolve());

    await finalizeMacDmgArtifacts(
      [makeResult("darwin", ["/tmp/outgroove.dmg"])],
      { signingEnabled: false },
      signArtifact,
      notarizeArtifact,
    );

    expect(signArtifact).not.toHaveBeenCalled();
    expect(notarizeArtifact).not.toHaveBeenCalled();
  });

  it("fails instead of silently publishing another container", async () => {
    await expect(
      finalizeMacDmgArtifacts(
        [makeResult("darwin", ["/tmp/outgroove.zip"])],
        releaseConfig,
        vi.fn(() => Promise.resolve()),
        vi.fn(() => Promise.resolve()),
      ),
    ).rejects.toThrow(/produced no DMG artifact/u);
  });
});
