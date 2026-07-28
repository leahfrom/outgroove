import { join } from "node:path";

export function bundledFpcalcTarget(
  platform: NodeJS.Platform,
  architecture: string,
): { readonly directory: string; readonly executable: string } | undefined {
  if (platform === "darwin" && architecture === "arm64")
    return { directory: "darwin-arm64", executable: "fpcalc" };
  if (platform === "linux" && architecture === "x64")
    return { directory: "linux-x64", executable: "fpcalc" };
  if (platform === "win32" && architecture === "x64")
    return { directory: "win32-x64", executable: "fpcalc.exe" };
  return undefined;
}

export function resolveBundledFpcalcPath(input: {
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly packaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
}): string | undefined {
  const target = bundledFpcalcTarget(input.platform, input.architecture);
  if (!target) return undefined;
  return input.packaged
    ? join(input.resourcesPath, target.executable)
    : join(
        input.appPath,
        "resources",
        "fpcalc",
        target.directory,
        target.executable,
      );
}
