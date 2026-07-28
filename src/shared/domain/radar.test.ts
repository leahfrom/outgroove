import { describe, expect, it } from "vitest";

import { classifyRadarItem, partialDateBounds } from "./radar";

describe("Radar release classification", () => {
  it("preserves exact and partial date bounds without inventing precision", () => {
    expect(partialDateBounds("2027")).toEqual({
      start: Date.UTC(2027, 0, 1),
      end: Date.UTC(2027, 11, 31),
    });
    expect(partialDateBounds("2027-02")).toEqual({
      start: Date.UTC(2027, 1, 1),
      end: Date.UTC(2027, 2, 0),
    });
    expect(partialDateBounds("2027-02-03")).toEqual({
      start: Date.UTC(2027, 1, 3),
      end: Date.UTC(2027, 1, 3),
    });
    expect(partialDateBounds("2027-02-30")).toBeNull();
  });

  it("classifies dates conservatively and keeps first-seen distinct from release timing", () => {
    expect(classifyRadarItem("2026-08", false, "2026-07-28")).toEqual([
      "upcoming",
    ]);
    expect(classifyRadarItem("2026-07-01", false, "2026-07-28")).toEqual([
      "recent",
    ]);
    expect(classifyRadarItem("2026-07", false, "2026-07-28")).toEqual([]);
    expect(classifyRadarItem("2020", true, "2026-07-28")).toEqual([
      "newly-found",
    ]);
    expect(classifyRadarItem("2026-08-01", true, "2026-07-28")).toEqual([
      "upcoming",
      "newly-found",
    ]);
  });
});
