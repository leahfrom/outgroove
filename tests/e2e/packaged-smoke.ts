import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

async function main(): Promise<void> {
  const executable =
    process.platform === "darwin"
      ? join(
          process.cwd(),
          "out",
          `outgroove-darwin-${process.arch}`,
          "outgroove.app",
          "Contents",
          "MacOS",
          "Outgroove",
        )
      : process.platform === "win32"
        ? join(
            process.cwd(),
            "out",
            `outgroove-win32-${process.arch}`,
            "Outgroove.exe",
          )
        : join(
            process.cwd(),
            "out",
            `outgroove-linux-${process.arch}`,
            "Outgroove",
          );

  await access(executable);
  const args = ["--smoke-test"];
  // GitHub's Linux runner cannot install Electron's chrome-sandbox helper as
  // root-owned mode 4755. This affects only the disposable CI launch; the app's
  // BrowserWindow sandbox configuration is still asserted by architecture tests.
  if (process.platform === "linux" && process.env.CI === "true") {
    args.push("--no-sandbox");
  }
  const child = spawn(executable, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OUTGROOVE_SMOKE_TEST: "1" },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const exitCode = await new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  clearTimeout(timeout);
  if (exitCode !== 0 || !output.includes("OUTGROOVE_SMOKE_OK"))
    throw new Error(`Packaged smoke failed (${exitCode}).\n${output}`);
  console.log(
    "Packaged app launched, opened SQLite, loaded the sandboxed renderer, parsed a fixture in its worker, and exited cleanly.",
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
