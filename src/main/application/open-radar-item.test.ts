import { describe, expect, it, vi } from "vitest";

import { OpenRadarItem } from "./open-radar-item";

const itemId = "4f2f7939-d847-47e0-a08e-ae47ac0727b2";
const releaseGroupId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

describe("Radar external navigation", () => {
  it("opens only the canonical MusicBrainz release-group URL from stored identity", async () => {
    const open = vi.fn(() => Promise.resolve());
    const service = new OpenRadarItem(
      { getCurrentRadarReleaseGroupId: vi.fn(() => releaseGroupId) },
      { open },
    );
    await expect(service.inMusicBrainz(itemId)).resolves.toEqual({
      opened: true,
    });
    expect(open).toHaveBeenCalledWith(
      "https://musicbrainz.org/release-group/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(JSON.stringify(open.mock.calls)).not.toMatch(
      /file:|javascript:|path|audio|tag/iu,
    );
  });

  it("refuses stale and malformed stored identities without opening a URL", async () => {
    const open = vi.fn(() => Promise.resolve());
    const missing = new OpenRadarItem(
      { getCurrentRadarReleaseGroupId: vi.fn(() => undefined) },
      { open },
    );
    await expect(missing.inMusicBrainz(itemId)).rejects.toThrow(
      "no longer in the current snapshot",
    );
    const malformed = new OpenRadarItem(
      {
        getCurrentRadarReleaseGroupId: vi.fn(
          () => "https://attacker.invalid/not-an-id",
        ),
      },
      { open },
    );
    await expect(malformed.inMusicBrainz(itemId)).rejects.toThrow(
      "invalid MusicBrainz identity",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("reports an OS browser-open failure", async () => {
    const service = new OpenRadarItem(
      { getCurrentRadarReleaseGroupId: vi.fn(() => releaseGroupId) },
      { open: vi.fn(() => Promise.reject(new Error("browser unavailable"))) },
    );
    await expect(service.inMusicBrainz(itemId)).rejects.toThrow(
      "browser unavailable",
    );
  });
});
