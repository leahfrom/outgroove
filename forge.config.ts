import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    // Keep LGPL-covered TagLib WebAssembly binaries physically replaceable in
    // app.asar.unpacked; Electron resolves the original module path through
    // the unpacked mirror without exposing it to the renderer.
    asar: {
      unpack: "**/node_modules/taglib-wasm/dist/*.wasm",
    },
    executableName: "Outgroove",
    // Vite bundles every production dependency except this native adapter.
    // An explicit allowlist avoids shipping the complete development tree while
    // ensuring Forge can rebuild and unpack SQLite for Electron's ABI.
    prune: false,
    ignore: (path) =>
      path.startsWith("/node_modules/") &&
      !/^\/node_modules\/(?:better-sqlite3|node-addon-api|taglib-wasm|@msgpack\/msgpack)(?:\/|$)/u.test(
        path,
      ),
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ["darwin", "win32", "linux"])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: "src/main/main.ts", config: "vite.main.config.ts" },
        { entry: "src/preload/preload.ts", config: "vite.preload.config.ts" },
        {
          entry: "src/workers/metadata-worker.ts",
          config: "vite.worker.config.ts",
        },
        {
          entry: "src/workers/library-discovery-worker.ts",
          config: "vite.worker.config.ts",
        },
        {
          entry: "src/workers/scan-database-worker.ts",
          config: "vite.worker.config.ts",
        },
        {
          entry: "src/workers/library-quality-worker.ts",
          config: "vite.worker.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
