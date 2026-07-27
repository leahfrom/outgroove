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
  "comment",
  "originalReleaseDate",
  "language",
  "publishers",
  "descriptions",
  "grouping",
  "catalogNumbers",
  "publishingDate",
  "bpm",
  "compilation",
  "musicBrainzRecordingId",
  "musicBrainzReleaseTrackId",
  "musicBrainzReleaseId",
  "musicBrainzArtistIds",
  "musicBrainzReleaseArtistIds",
  "musicBrainzReleaseGroupId",
  "musicBrainzWorkId",
] as const;

export type EditableTrackTagField = (typeof editableTrackTagFields)[number];
export type TrackTagChanges = Partial<
  Pick<NormalizedTags, EditableTrackTagField>
>;
export type TrackTagChangeInput = {
  readonly [Field in EditableTrackTagField]?: NormalizedTags[Field] | undefined;
};

const musicBrainzIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isValidMusicBrainzId(value: string): boolean {
  return musicBrainzIdPattern.test(value);
}

function normalizedOptionalText(
  value: string | null | undefined,
  field: string,
  maximum: number,
): string | null {
  if (value === undefined) throw new Error(`${field} is invalid.`);
  const normalized =
    value?.normalize("NFC").replace(/\s+/gu, " ").trim() ?? null;
  const result = normalized === "" ? null : normalized;
  if (result !== null && result.length > maximum)
    throw new Error(`${field} is too long.`);
  return result;
}

function normalizedSingleValueList(
  value: readonly string[] | undefined,
  field: string,
  maximum: number,
): readonly string[] {
  if (!value) throw new Error(`${field} values are invalid.`);
  const normalized = normalizeTagTextList(value);
  if (normalized.length > 1)
    throw new Error(`This writer currently supports one proposed ${field}.`);
  if (normalized.some((item) => item.length > maximum))
    throw new Error(`${field} is too long.`);
  return normalized;
}

function normalizedMusicBrainzId(
  value: string | null | undefined,
  field: string,
): string | null {
  const normalized = normalizedOptionalText(value, field, 36);
  if (normalized !== null && !isValidMusicBrainzId(normalized))
    throw new Error(`${field} must be a valid MusicBrainz UUID.`);
  return normalized?.toLocaleLowerCase("en-US") ?? null;
}

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
  if ("comment" in input) {
    if (input.comment === undefined) throw new Error("comment is invalid.");
    const normalized =
      input.comment?.normalize("NFC").replace(/\r\n?/gu, "\n").trim() ?? null;
    const comment = normalized === "" ? null : normalized;
    if (comment !== null && comment.length > 4000)
      throw new Error("comment is too long.");
    Object.assign(output, { comment });
  }
  if ("originalReleaseDate" in input) {
    if (input.originalReleaseDate === undefined)
      throw new Error("original release date is invalid.");
    const trimmed = input.originalReleaseDate?.trim() ?? null;
    const originalReleaseDate = trimmed === "" ? null : trimmed;
    if (
      originalReleaseDate !== null &&
      !isValidPartialDate(originalReleaseDate)
    )
      throw new Error(
        "original release date must be YYYY, YYYY-MM, or a valid YYYY-MM-DD.",
      );
    Object.assign(output, { originalReleaseDate });
  }
  if ("language" in input) {
    if (input.language === undefined) throw new Error("language is invalid.");
    const normalized =
      input.language?.normalize("NFC").replace(/\s+/gu, " ").trim() ?? null;
    const language = normalized === "" ? null : normalized;
    if (language !== null && language.length > 100)
      throw new Error("language is too long.");
    Object.assign(output, { language });
  }
  if ("publishers" in input)
    Object.assign(output, {
      publishers: normalizedSingleValueList(input.publishers, "publisher", 400),
    });
  if ("descriptions" in input)
    Object.assign(output, {
      descriptions: normalizedSingleValueList(
        input.descriptions,
        "description",
        4000,
      ),
    });
  if ("grouping" in input)
    Object.assign(output, {
      grouping: normalizedOptionalText(input.grouping, "grouping", 1000),
    });
  if ("catalogNumbers" in input)
    Object.assign(output, {
      catalogNumbers: normalizedSingleValueList(
        input.catalogNumbers,
        "catalog number",
        200,
      ),
    });
  if ("publishingDate" in input) {
    if (input.publishingDate === undefined)
      throw new Error("publishing date is invalid.");
    const trimmed = input.publishingDate?.trim() ?? null;
    const publishingDate = trimmed === "" ? null : trimmed;
    if (publishingDate !== null && !isValidPartialDate(publishingDate))
      throw new Error(
        "publishing date must be YYYY, YYYY-MM, or a valid YYYY-MM-DD.",
      );
    Object.assign(output, { publishingDate });
  }
  if ("bpm" in input) {
    const bpm = input.bpm;
    if (
      bpm === undefined ||
      (bpm !== null && (!Number.isInteger(bpm) || bpm < 1 || bpm > 999))
    )
      throw new Error("BPM must be between 1 and 999.");
    Object.assign(output, { bpm });
  }
  if ("compilation" in input) {
    if (typeof input.compilation !== "boolean")
      throw new Error("compilation must be yes or no.");
    Object.assign(output, { compilation: input.compilation });
  }
  for (const field of [
    "musicBrainzRecordingId",
    "musicBrainzReleaseTrackId",
    "musicBrainzReleaseId",
    "musicBrainzReleaseGroupId",
    "musicBrainzWorkId",
  ] as const) {
    if (!(field in input)) continue;
    Object.assign(output, {
      [field]: normalizedMusicBrainzId(input[field], field),
    });
  }
  for (const field of [
    "musicBrainzArtistIds",
    "musicBrainzReleaseArtistIds",
  ] as const) {
    if (!(field in input)) continue;
    const values = normalizedSingleValueList(input[field], field, 36);
    if (values.some((value) => !isValidMusicBrainzId(value)))
      throw new Error(`${field} must contain a valid MusicBrainz UUID.`);
    Object.assign(output, {
      [field]: values.map((value) => value.toLocaleLowerCase("en-US")),
    });
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
      left.every(
        (value, index) =>
          JSON.stringify(value) === JSON.stringify(right[index]),
      )
    );
  return left === right;
}
