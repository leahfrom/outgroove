import {
  normalizeGenres,
  normalizeTagTextList,
  type NormalizedTags,
} from "./catalog";
import { isValidPartialDate } from "./partial-date";

export { isValidPartialDate } from "./partial-date";

export const editableTrackTagFields = [
  "title",
  "artist",
  "albumArtist",
  "trackNumber",
  "discNumber",
  "year",
  "genres",
  "composers",
] as const;

export type EditableTrackTagField = (typeof editableTrackTagFields)[number];
export type TrackTagChanges = Partial<
  Pick<NormalizedTags, EditableTrackTagField>
>;
export type TrackTagChangeInput = {
  readonly [Field in EditableTrackTagField]?: NormalizedTags[Field] | undefined;
};

export function normalizeTrackTagChanges(
  input: TrackTagChangeInput,
): TrackTagChanges {
  const output: TrackTagChanges = {};
  for (const field of ["title", "artist", "albumArtist"] as const) {
    if (!(field in input)) continue;
    const value = input[field]?.normalize("NFC").replace(/\s+/gu, " ").trim();
    if (!value) throw new Error(`${field} cannot be empty.`);
    if (value.length > 400) throw new Error(`${field} is too long.`);
    Object.assign(output, { [field]: value });
  }
  for (const [field, maximum] of [
    ["trackNumber", 9999],
    ["discNumber", 999],
  ] as const) {
    if (!(field in input)) continue;
    const value = input[field];
    if (
      value === undefined ||
      (value !== null &&
        (!Number.isInteger(value) || value < 1 || value > maximum))
    )
      throw new Error(`${field} must be between 1 and ${maximum}.`);
    Object.assign(output, { [field]: value });
  }
  if ("year" in input) {
    if (input.year === undefined) throw new Error("year is invalid.");
    const trimmed = input.year?.trim() ?? null;
    const value = trimmed === "" ? null : trimmed;
    if (value !== null && !isValidPartialDate(value))
      throw new Error("year must be YYYY, YYYY-MM, or a valid YYYY-MM-DD.");
    Object.assign(output, { year: value });
  }
  if ("genres" in input) {
    const submitted = input.genres;
    if (!submitted) throw new Error("genres are invalid.");
    const genres = normalizeGenres(submitted);
    if (genres.length > 1)
      throw new Error(
        "This writer currently supports one proposed genre value.",
      );
    if (genres.some((genre) => genre.length > 100))
      throw new Error("genre is too long.");
    Object.assign(output, { genres });
  }
  if ("composers" in input) {
    const submitted = input.composers;
    if (!submitted) throw new Error("composers are invalid.");
    const composers = normalizeTagTextList(submitted);
    if (composers.length > 1)
      throw new Error(
        "This writer currently supports one proposed composer value.",
      );
    if (composers.some((composer) => composer.length > 400))
      throw new Error("composer is too long.");
    Object.assign(output, { composers });
  }
  if (Object.keys(output).length === 0)
    throw new Error("Choose at least one metadata field to change.");
  return output;
}

export function changedTrackTags(
  before: NormalizedTags,
  proposed: TrackTagChanges,
): TrackTagChanges {
  const changes: TrackTagChanges = {};
  for (const field of editableTrackTagFields)
    if (
      field in proposed &&
      !trackTagValueEquals(proposed[field], before[field])
    )
      Object.assign(changes, { [field]: proposed[field] });
  return changes;
}

export function trackTagValueEquals(
  left: NormalizedTags[EditableTrackTagField] | undefined,
  right: NormalizedTags[EditableTrackTagField] | undefined,
): boolean {
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  return left === right;
}
