import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  packagedInspectionReadySchema,
  type PackagedInspectionReady,
} from "../src/main/inspection/packaged-inspection";

interface PackagePaths {
  readonly app: string;
  readonly executable: string;
}

interface InspectionLaunch {
  readonly app: string;
  readonly configPath: string;
  readonly ready: PackagedInspectionReady;
  readonly root: string;
}

function packagePaths(): PackagePaths {
  const applicationName = "Outgroove Inspection";
  const output = join(
    process.cwd(),
    "out",
    `${applicationName}-${process.platform}-${process.arch}`,
  );
  if (process.platform === "darwin") {
    const app = join(output, `${applicationName}.app`);
    return {
      app,
      executable: join(app, "Contents", "MacOS", applicationName),
    };
  }
  const executable = join(
    output,
    process.platform === "win32" ? `${applicationName}.exe` : applicationName,
  );
  return { app: executable, executable };
}

function packageEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OUTGROOVE_INSPECTION_BUILD: "1",
    OUTGROOVE_MAC_SIGNING: "0",
  };
}

async function runInspectionPackage(): Promise<void> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm, ["exec", "electron-forge", "package"], {
      cwd: process.cwd(),
      env: packageEnvironment(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Inspection package failed (${code ?? signal ?? "unknown"}).`,
          ),
        );
    });
  });
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function stopInspectionProcess(pid: number): Promise<void> {
  if (!processIsRunning(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!processIsRunning(pid)) return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForReadyMarker(
  path: string,
  child: ChildProcess,
  expected: {
    readonly sessionId: string;
    readonly userData: string;
    readonly targetRoot: string;
    readonly fixtureLibraryRoot: string | null;
  },
  launchError: () => Error | undefined,
  output: () => string,
): Promise<PackagedInspectionReady> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const error = launchError();
    if (error) throw error;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Inspection app exited before readiness (${child.exitCode ?? child.signalCode ?? "unknown"}).\n${output()}`,
      );
    try {
      const ready = packagedInspectionReadySchema.parse(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      );
      if (
        ready.sessionId !== expected.sessionId ||
        ready.userData !== expected.userData ||
        ready.targetRoot !== expected.targetRoot ||
        ready.fixtureLibraryRoot !== expected.fixtureLibraryRoot
      )
        throw new Error(
          "Inspection readiness marker does not match the launched disposable session.",
        );
      return ready;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Inspection app did not publish readiness within 45 seconds.\n${output()}`,
  );
}

async function launchInspection(seedFixtureLibrary: boolean): Promise<{
  readonly child: ChildProcess;
  readonly launch: InspectionLaunch;
  readonly output: () => string;
}> {
  const createdRoot = await mkdtemp(join(tmpdir(), "outgroove-inspection-"));
  const root = await realpath(createdRoot);
  let child: ChildProcess | undefined;
  try {
    const userData = join(root, "profile");
    const targetRoot = join(root, "target");
    const fixtureLibraryRoot = seedFixtureLibrary
      ? join(root, "fixture-library")
      : null;
    const configPath = join(root, "inspection.json");
    const readyMarker = join(root, "ready.json");
    await mkdir(userData);
    await mkdir(targetRoot);
    if (fixtureLibraryRoot)
      await cp(
        join(process.cwd(), "fixtures", "audio", "preservation"),
        fixtureLibraryRoot,
        { recursive: true },
      );
    const sessionId = randomUUID();
    await writeFile(
      configPath,
      `${JSON.stringify({
        protocolVersion: 1,
        sessionId,
        root,
        userData,
        targetRoot,
        fixtureLibraryRoot,
        readyMarker,
      })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );

    const paths = packagePaths();
    await access(paths.executable);
    const runtimeEnvironment = { ...process.env };
    delete runtimeEnvironment.OUTGROOVE_SMOKE_TEST;
    delete runtimeEnvironment.OUTGROOVE_SMOKE_USER_DATA;
    child = spawn(
      paths.executable,
      [`--outgroove-inspection-config=${configPath}`],
      {
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        env: runtimeEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let spawnError: Error | undefined;
    child.on("error", (error) => {
      spawnError = error;
      output += `${error.message}\n`;
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const ready = await waitForReadyMarker(
      readyMarker,
      child,
      { sessionId, userData, targetRoot, fixtureLibraryRoot },
      () => spawnError,
      () => output,
    );
    return {
      child,
      launch: {
        app: paths.app,
        configPath,
        ready,
        root,
      },
      output: () => output,
    };
  } catch (error) {
    child?.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function parseArguments(args: readonly string[]): {
  readonly seedFixtureLibrary: boolean;
} {
  let seedFixtureLibrary = true;
  for (const argument of args) {
    if (argument === "--empty") seedFixtureLibrary = false;
    else throw new Error(`Unknown packaged inspection option: ${argument}`);
  }
  return { seedFixtureLibrary };
}

async function main(): Promise<void> {
  const { seedFixtureLibrary } = parseArguments(process.argv.slice(2));
  await runInspectionPackage();
  const { child, launch, output } = await launchInspection(seedFixtureLibrary);
  let emergencyCleanup:
    | {
        readonly pid: number;
        readonly root: string;
      }
    | undefined = {
    pid: launch.ready.pid,
    root: launch.root,
  };
  process.once("exit", () => {
    if (!emergencyCleanup) return;
    try {
      process.kill(emergencyCleanup.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        // The asynchronous cleanup path reports failures. This last-resort
        // handler must remain synchronous and cannot recover further.
      }
    }
    try {
      rmSync(emergencyCleanup.root, { recursive: true, force: true });
    } catch {
      // The asynchronous cleanup path reports failures where recovery remains
      // possible; process exit leaves no such channel.
    }
  });
  console.log(
    `OUTGROOVE_INSPECTION_READY=${JSON.stringify({
      ...launch.ready,
      app: launch.app,
      configPath: launch.configPath,
      root: launch.root,
    })}`,
  );
  console.log(
    "The packaged app is using disposable fixture state. Press Ctrl+C to close it and remove the entire inspection directory.",
  );

  let stopRequested = false;
  let signalHandler: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      signalHandler = () => {
        stopRequested = true;
        resolve();
      };
      // npm forwards terminal signals after Node receives them directly. Keep
      // both listeners installed through cleanup so the forwarded duplicate
      // cannot restore Node's default immediate termination behavior.
      process.on("SIGINT", signalHandler);
      process.on("SIGTERM", signalHandler);
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (stopRequested || code === 0) resolve();
        else
          reject(
            new Error(
              `Inspection app exited unexpectedly (${code ?? signal ?? "unknown"}).\n${output()}`,
            ),
          );
      });
    });
  } finally {
    try {
      await stopInspectionProcess(launch.ready.pid);
    } finally {
      try {
        await rm(launch.root, { recursive: true, force: true });
      } finally {
        if (signalHandler) {
          process.removeListener("SIGINT", signalHandler);
          process.removeListener("SIGTERM", signalHandler);
        }
      }
    }
    emergencyCleanup = undefined;
  }
  console.log("OUTGROOVE_INSPECTION_CLEANED");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
