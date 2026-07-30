import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { link, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

const inspectionArgumentPrefix = "--outgroove-inspection-config=";
const inspectionRootPrefix = "outgroove-inspection-";

function hasInspectionRootPrefix(path: string): boolean {
  const name = basename(path);
  return (process.platform === "win32" ? name.toLowerCase() : name).startsWith(
    inspectionRootPrefix,
  );
}

const inspectionConfigSchema = z
  .object({
    protocolVersion: z.literal(1),
    sessionId: z.uuid(),
    root: z.string().min(1),
    userData: z.string().min(1),
    targetRoot: z.string().min(1),
    fixtureLibraryRoot: z.string().min(1).nullable(),
    readyMarker: z.string().min(1),
  })
  .strict();

export const packagedInspectionReadySchema = z
  .object({
    protocolVersion: z.literal(1),
    sessionId: z.uuid(),
    pid: z.number().int().positive(),
    appPath: z.string().min(1),
    executablePath: z.string().min(1),
    userData: z.string().min(1),
    databasePath: z.string().min(1),
    targetRoot: z.string().min(1),
    fixtureLibraryRoot: z.string().min(1).nullable(),
  })
  .strict();

export interface PackagedInspectionSession {
  readonly protocolVersion: 1;
  readonly sessionId: string;
  readonly root: string;
  readonly userData: string;
  readonly targetRoot: string;
  readonly fixtureLibraryRoot: string | null;
  readonly readyMarker: string;
}

export type PackagedInspectionReady = z.infer<
  typeof packagedInspectionReadySchema
>;

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function sameFilesystemObject(first: string, second: string): boolean {
  const firstInfo = statSync(first);
  const secondInfo = statSync(second);
  return firstInfo.dev === secondInfo.dev && firstInfo.ino === secondInfo.ino;
}

function isFilesystemContained(root: string, candidate: string): boolean {
  let current = candidate;
  for (;;) {
    if (sameFilesystemObject(root, current)) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function existingDirectory(path: string, label: string): string {
  if (!isAbsolute(path))
    throw new Error(`Packaged inspection ${label} must be absolute.`);
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory())
    throw new Error(`Packaged inspection ${label} must be a directory.`);
  return canonical;
}

function containedExistingDirectory(
  root: string,
  path: string,
  label: string,
): string {
  const canonical = existingDirectory(path, label);
  if (!isFilesystemContained(root, canonical))
    throw new Error(
      `Packaged inspection ${label} must stay inside its temporary root.`,
    );
  return canonical;
}

export function loadPackagedInspectionSession(
  enabled: boolean,
  args: readonly string[],
  temporaryDirectory = tmpdir(),
): PackagedInspectionSession | undefined {
  if (!enabled) return undefined;

  const configArguments = args.filter((argument) =>
    argument.startsWith(inspectionArgumentPrefix),
  );
  if (configArguments.length !== 1)
    throw new Error(
      "An inspection build requires exactly one packaged inspection configuration.",
    );

  const configPath = configArguments[0]?.slice(inspectionArgumentPrefix.length);
  if (!configPath || !isAbsolute(configPath))
    throw new Error(
      "The packaged inspection configuration path must be absolute.",
    );

  const canonicalTemporaryDirectory = existingDirectory(
    temporaryDirectory,
    "temporary directory",
  );
  const suppliedRoot = dirname(resolve(configPath));
  if (
    !hasInspectionRootPrefix(suppliedRoot) ||
    lstatSync(suppliedRoot).isSymbolicLink()
  )
    throw new Error(
      "Packaged inspection configuration must be inside a generated Outgroove temporary directory.",
    );
  const canonicalConfigPath = realpathSync(configPath);
  if (!isFilesystemContained(canonicalTemporaryDirectory, canonicalConfigPath))
    throw new Error(
      "Packaged inspection configuration must be inside a generated Outgroove temporary directory.",
    );
  const parsed = inspectionConfigSchema.parse(
    JSON.parse(readFileSync(canonicalConfigPath, "utf8")) as unknown,
  );
  const root = existingDirectory(parsed.root, "root");
  if (!sameFilesystemObject(root, dirname(canonicalConfigPath)))
    throw new Error(
      "Packaged inspection root must be a generated Outgroove directory inside the OS temporary directory.",
    );

  const userData = containedExistingDirectory(
    root,
    parsed.userData,
    "user-data directory",
  );
  const targetRoot = containedExistingDirectory(
    root,
    parsed.targetRoot,
    "target directory",
  );
  const fixtureLibraryRoot =
    parsed.fixtureLibraryRoot === null
      ? null
      : containedExistingDirectory(
          root,
          parsed.fixtureLibraryRoot,
          "fixture Library directory",
        );
  if (!isAbsolute(parsed.readyMarker))
    throw new Error("Packaged inspection ready marker path must be absolute.");
  const markerParent = existingDirectory(
    dirname(parsed.readyMarker),
    "ready-marker parent",
  );
  if (!isFilesystemContained(root, markerParent))
    throw new Error(
      "Packaged inspection ready marker must stay inside its temporary root.",
    );
  const readyMarker = resolve(markerParent, basename(parsed.readyMarker));
  if (existsSync(readyMarker))
    throw new Error(
      "Packaged inspection ready marker already exists; refusing to overwrite it.",
    );

  return {
    protocolVersion: 1,
    sessionId: parsed.sessionId,
    root,
    userData,
    targetRoot,
    fixtureLibraryRoot,
    readyMarker,
  };
}

export async function writePackagedInspectionReadyMarker(
  session: PackagedInspectionSession,
  ready: Omit<
    PackagedInspectionReady,
    | "protocolVersion"
    | "sessionId"
    | "userData"
    | "targetRoot"
    | "fixtureLibraryRoot"
  >,
): Promise<PackagedInspectionReady> {
  const marker = packagedInspectionReadySchema.parse({
    protocolVersion: 1,
    sessionId: session.sessionId,
    userData: session.userData,
    targetRoot: session.targetRoot,
    fixtureLibraryRoot: session.fixtureLibraryRoot,
    ...ready,
  });
  if (
    !isContained(session.userData, marker.databasePath) ||
    !isContained(session.root, session.readyMarker)
  )
    throw new Error(
      "Packaged inspection marker paths escaped the validated inspection directories.",
    );
  const temporaryMarker = `${session.readyMarker}.${session.sessionId}.tmp`;
  await writeFile(temporaryMarker, `${JSON.stringify(marker)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    // Hard-link publication is atomic and refuses an existing destination,
    // so marker presence always means the complete record is readable.
    await link(temporaryMarker, session.readyMarker);
  } finally {
    await unlink(temporaryMarker);
  }
  return marker;
}
