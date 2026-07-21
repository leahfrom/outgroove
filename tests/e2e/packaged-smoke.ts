import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

async function main(): Promise<void> {
  const executable =
    process.platform === "darwin"
      ? join(
          process.cwd(),
          "out",
          `Outgroove-darwin-${process.arch}`,
          "Outgroove.app",
          "Contents",
          "MacOS",
          "Outgroove",
        )
      : process.platform === "win32"
        ? join(
            process.cwd(),
            "out",
            `Outgroove-win32-${process.arch}`,
            "Outgroove.exe",
          )
        : join(
            process.cwd(),
            "out",
            `Outgroove-linux-${process.arch}`,
            "outgroove",
          );

  await access(executable);
  const child = spawn(executable, ["--smoke-test"], {
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
