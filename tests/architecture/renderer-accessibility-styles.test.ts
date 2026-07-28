import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../../src/renderer/styles.css", import.meta.url),
  "utf8",
);

describe("renderer accessibility styles", () => {
  it("suppresses non-essential motion when reduced motion is requested", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("animation-duration: 0.01ms !important");
    expect(styles).toContain(
      ".album-artwork-placeholder.loading {\n    animation: none;",
    );
  });

  it("preserves focus, current state, dialogs, and comparison states in forced colors", () => {
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toContain("outline-color: Highlight");
    expect(styles).toContain(
      '.album-editing-tools button[aria-current="page"]',
    );
    expect(styles).toContain('.tag-comparison-row[data-changed="true"]');
    expect(styles).toContain(
      '.sequence-comparison > ol > li[data-invalid="true"]',
    );
    expect(styles).toContain("background: CanvasText");
  });

  it("keeps Radar filter controls inside their responsive grid tracks", () => {
    expect(styles).toContain(
      ".radar-releases .section-heading {\n  display: flex;\n  flex-wrap: wrap;",
    );
    expect(styles).toContain(
      ".radar-filters select {\n  display: block;\n  width: 100%;\n  min-width: 0;",
    );
  });
});
