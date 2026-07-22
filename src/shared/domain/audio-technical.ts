export function normalizeTechnicalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function positiveFinite(value: number | null | undefined): number | null {
  return normalizeTechnicalNumber(value);
}

export function formatDuration(seconds: number | null | undefined): string {
  const value = positiveFinite(seconds);
  if (value === null) return "Unknown";
  if (value < 60) return `${value.toFixed(1)} s`;
  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function formatBitrate(bitrate: number | null | undefined): string {
  const value = positiveFinite(bitrate);
  return value === null ? "Unknown" : `${Math.round(value / 1000)} kbps`;
}

export function formatSampleRate(
  sampleRate: number | null | undefined,
): string {
  const value = positiveFinite(sampleRate);
  if (value === null) return "Unknown";
  const kilohertz = value / 1000;
  return `${Number.isInteger(kilohertz) ? kilohertz : kilohertz.toFixed(1)} kHz`;
}

export function formatBitDepth(bitDepth: number | null | undefined): string {
  const value = positiveFinite(bitDepth);
  return value === null || !Number.isInteger(value)
    ? "Unknown"
    : `${value}-bit`;
}

export function formatChannels(channels: number | null | undefined): string {
  const value = positiveFinite(channels);
  if (value === null || !Number.isInteger(value)) return "Unknown";
  if (value === 1) return "Mono (1 channel)";
  if (value === 2) return "Stereo (2 channels)";
  return `${value} channels`;
}

export function formatFileSize(size: number | null | undefined): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0)
    return "Unknown";
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const precision = unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unit]}`;
}
