import type { ForgeMakeResult } from "@electron-forge/shared-types";
import { notarize } from "@electron/notarize";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type Environment = Readonly<Record<string, string | undefined>>;

export type MacNotarizationCredentials =
  | {
      readonly keychainProfile: string;
    }
  | {
      readonly appleApiKey: string;
      readonly appleApiKeyId: string;
      readonly appleApiIssuer: string;
    };

export type MacReleaseConfig =
  | {
      readonly signingEnabled: false;
    }
  | {
      readonly signingEnabled: true;
      readonly signingIdentity: string;
      readonly notarizationCredentials?: MacNotarizationCredentials;
    };

function present(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

export function resolveMacReleaseConfig(
  environment: Environment,
): MacReleaseConfig {
  const signingEnabled = environment.OUTGROOVE_MAC_SIGNING === "1";
  const signingIdentity = present(environment.OUTGROOVE_MAC_SIGNING_IDENTITY);
  const keychainProfile = present(
    environment.OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE,
  );
  const appleApiKey = present(environment.OUTGROOVE_MAC_NOTARY_API_KEY_PATH);
  const appleApiKeyId = present(environment.OUTGROOVE_MAC_NOTARY_API_KEY_ID);
  const appleApiIssuer = present(environment.OUTGROOVE_MAC_NOTARY_API_ISSUER);
  const apiCredentialCount = [
    appleApiKey,
    appleApiKeyId,
    appleApiIssuer,
  ].filter(Boolean).length;

  if (apiCredentialCount > 0 && apiCredentialCount < 3)
    throw new Error(
      "macOS API-key notarization requires key path, key ID, and issuer.",
    );

  if (keychainProfile && apiCredentialCount === 3)
    throw new Error(
      "Choose either a macOS notarization keychain profile or API-key credentials, not both.",
    );

  const notarizationCredentials: MacNotarizationCredentials | undefined =
    keychainProfile
      ? { keychainProfile }
      : appleApiKey && appleApiKeyId && appleApiIssuer
        ? { appleApiKey, appleApiKeyId, appleApiIssuer }
        : undefined;

  if (notarizationCredentials && !signingEnabled)
    throw new Error(
      "macOS notarization credentials require OUTGROOVE_MAC_SIGNING=1.",
    );

  if (!signingEnabled) return { signingEnabled: false };

  return {
    signingEnabled: true,
    signingIdentity: required(
      signingIdentity,
      "OUTGROOVE_MAC_SIGNING=1 requires OUTGROOVE_MAC_SIGNING_IDENTITY.",
    ),
    ...(notarizationCredentials ? { notarizationCredentials } : {}),
  };
}

type NotarizeArtifact = (
  options: { readonly appPath: string } & MacNotarizationCredentials,
) => Promise<void>;
type SignArtifact = (path: string, identity: string) => Promise<void>;

const notarizeDmg: NotarizeArtifact = async (options) => {
  await notarize({ tool: "notarytool", ...options });
};

export function macDmgCodeSignArguments(
  identity: string,
  path: string,
): string[] {
  return [
    "--sign",
    identity,
    "--timestamp",
    "--identifier",
    "de.leahfrom.outgroove.dmg",
    path,
  ];
}

const execFileAsync = promisify(execFile);
const signDmg: SignArtifact = async (path, identity) => {
  await execFileAsync("codesign", macDmgCodeSignArguments(identity, path));
};

export async function finalizeMacDmgArtifacts(
  makeResults: readonly ForgeMakeResult[],
  releaseConfig: MacReleaseConfig,
  signArtifact: SignArtifact = signDmg,
  notarizeArtifact: NotarizeArtifact = notarizeDmg,
): Promise<void> {
  if (!releaseConfig.signingEnabled) return;

  const dmgArtifacts = makeResults.flatMap((result) =>
    result.platform === "darwin"
      ? result.artifacts.filter((artifact) =>
          artifact.toLocaleLowerCase("en-US").endsWith(".dmg"),
        )
      : [],
  );

  if (dmgArtifacts.length === 0)
    throw new Error(
      "macOS signing was requested, but Forge produced no DMG artifact.",
    );

  for (const appPath of dmgArtifacts) {
    await signArtifact(appPath, releaseConfig.signingIdentity);
    if (releaseConfig.notarizationCredentials)
      await notarizeArtifact({
        appPath,
        ...releaseConfig.notarizationCredentials,
      });
  }
}
