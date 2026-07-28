import { isValidPartialDate } from "./partial-date";

export const radarReasons = ["upcoming", "recent", "newly-found"] as const;
export type RadarReason = (typeof radarReasons)[number];

export interface RadarReleaseGroupObservation {
  readonly releaseGroupId: string;
  readonly representativeReleaseId: string;
  readonly title: string;
  readonly primaryType: string | null;
  readonly secondaryTypes: readonly string[];
  readonly firstReleaseDate: string | null;
  readonly status: string | null;
  readonly country: string | null;
}

interface PartialDateBounds {
  readonly start: number;
  readonly end: number;
}

export function partialDateBounds(value: string): PartialDateBounds | null {
  if (!isValidPartialDate(value)) return null;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = monthText ? Number(monthText) : 1;
  const day = dayText ? Number(dayText) : 1;
  const start = Date.UTC(year, month - 1, day);
  if (dayText) return { start, end: start };
  if (monthText)
    return {
      start,
      end: Date.UTC(year, month, 0),
    };
  return {
    start,
    end: Date.UTC(year, 11, 31),
  };
}

export function classifyRadarItem(
  firstReleaseDate: string | null,
  discoveredAfterBaseline: boolean,
  today: string,
): readonly RadarReason[] {
  if (!isValidPartialDate(today) || today.length !== 10)
    throw new Error("Radar classification requires an exact current date.");
  const reasons: RadarReason[] = [];
  const bounds = firstReleaseDate ? partialDateBounds(firstReleaseDate) : null;
  const todayAt = Date.parse(`${today}T00:00:00.000Z`);
  if (bounds?.start !== undefined && bounds.start > todayAt)
    reasons.push("upcoming");
  const recentStart = todayAt - 89 * 24 * 60 * 60 * 1000;
  if (bounds && bounds.start >= recentStart && bounds.end <= todayAt)
    reasons.push("recent");
  if (discoveredAfterBaseline) reasons.push("newly-found");
  return reasons;
}
