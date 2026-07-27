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
  "trackTotal",
  "discNumber",
  "discTotal",
  "year",
  "genres",
  "composers",
  "conductors",
  "lyricists",
  "isrcs",
  "copyright",
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
    ["trackTotal", 9999],
    ["discNumber", 999],
    ["discTotal", 999],
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
  if ("conductors" in input) {
    const submitted = input.conductors;
    if (!submitted) throw new Error("conductors are invalid.");
    const conductors = normalizeTagTextList(submitted);
    if (conductors.length > 1)
      throw new Error(
        "This writer currently supports one proposed conductor value.",
      );
    if (conductors.some((conductor) => conductor.length > 400))
      throw new Error("conductor is too long.");
    Object.assign(output, { conductors });
  }
  if ("lyricists" in input) {
    const submitted = input.lyricists;
    if (!submitted) throw new Error("lyricists are invalid.");
    const lyricists = normalizeTagTextList(submitted);
    if (lyricists.length > 1)
      throw new Error(
        "This writer currently supports one proposed lyricist value.",
      );
    if (lyricists.some((lyricist) => lyricist.length > 400))
      throw new Error("lyricist is too long.");
    Object.assign(output, { lyricists });
  }
  if ("isrcs" in input) {
    const submitted = input.isrcs;
    if (!submitted) throw new Error("ISRC values are invalid.");
    const isrcs = normalizeTagTextList(submitted);
    if (isrcs.length > 1)
      throw new Error("This writer currently supports one proposed ISRC.");
    if (isrcs.some((isrc) => isrc.length > 100))
      throw new Error("ISRC is too long.");
    Object.assign(output, { isrcs });
  }
  if ("copyright" in input) {
    if (input.copyright === undefined) throw new Error("copyright is invalid.");
    const normalized =
      input.copyright?.normalize("NFC").replace(/\s+/gu, " ").trim() ?? null;
    const copyright = normalized === "" ? null : normalized;
    if (copyright !== null && copyright.length > 1000)
      throw new Error("copyright is too long.");
    Object.assign(output, { copyright });
  }
  if (Object.keys(output).length === 0)
    throw new Error("Choose at least one metadata field to change.");
  return output;
}

export function validateTrackTagRelationships(
  before: NormalizedTags,
  changes: TrackTagChanges,
): void {
  for (const [numberField, totalField, label] of [
    ["trackNumber", "trackTotal", "Track"],
    ["discNumber", "discTotal", "Disc"],
  ] as const) {
    if (!(numberField in changes) && !(totalField in changes)) continue;
    const number =
      (numberField in changes ? changes[numberField] : before[numberField]) ??
      null;
    const total =
      (totalField in changes ? changes[totalField] : before[totalField]) ??
      null;
    if (total !== null && number === null)
      throw new Error(
        `${label} total requires a ${label.toLocaleLowerCase("en-US")} number; set both or clear the total.`,
      );
    if (number !== null && total !== null && number > total)
      throw new Error(
        `${label} number ${number} cannot exceed ${label.toLocaleLowerCase("en-US")} total ${total}.`,
      );
  }
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
