import { describe, expect, it } from "vitest";

import {
  formatBitDepth,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
  normalizeTechnicalNumber,
} from "./audio-technical";

describe("audio technical property formatting", () => {
  it("formats common audio properties deterministically", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(119.9)).toBe("2:00");
    expect(formatBitrate(127_999.6)).toBe("128 kbps");
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
    expect(formatSampleRate(96_000)).toBe("96 kHz");
    expect(formatBitDepth(16)).toBe("16-bit");
    expect(formatChannels(1)).toBe("Mono (1 channel)");
    expect(formatChannels(2)).toBe("Stereo (2 channels)");
    expect(formatChannels(6)).toBe("6 channels");
    expect(formatFileSize(1_572_864)).toBe("1.50 MiB");
    expect(normalizeTechnicalNumber(44_100)).toBe(44_100);
  });

  it("uses visible Unknown text for absent or invalid properties", () => {
    expect(formatDuration(null)).toBe("Unknown");
    expect(formatBitrate(0)).toBe("Unknown");
    expect(formatSampleRate(undefined)).toBe("Unknown");
    expect(formatBitDepth(Number.NaN)).toBe("Unknown");
    expect(formatChannels(-1)).toBe("Unknown");
    expect(formatChannels(1.5)).toBe("Unknown");
    expect(formatBitDepth(16.5)).toBe("Unknown");
    expect(formatFileSize(undefined)).toBe("Unknown");
    expect(normalizeTechnicalNumber("44100")).toBeNull();
  });
});
