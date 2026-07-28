import { defineConfig } from "vite";

export default defineConfig({
  define: {
    OUTGROOVE_MAC_NOTIFICATIONS_READY: JSON.stringify(
      process.env.OUTGROOVE_MAC_SIGNING === "1",
    ),
    OUTGROOVE_ACOUSTID_API_KEY: JSON.stringify(
      process.env.OUTGROOVE_ACOUSTID_API_KEY ?? null,
    ),
  },
  build: {
    rollupOptions: {
      external: ["better-sqlite3", "electron", "taglib-wasm"],
    },
  },
});
