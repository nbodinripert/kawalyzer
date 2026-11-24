import { z } from "zod";
import { corpusNameList, corpusNames, type CorpusLanguage } from "./corpora";
import { findBlockingDuplicates } from "./duplicates";
import { shapeIds, thumbKeyIds, type ShapeId } from "./geometry";
import { importKalamine } from "./kalamine";
import { completeLayoutPairs, isPair, type KeyChars, type Layout } from "./layout";
import { emptyReplacements, parseReplacements, type Replacements } from "./replacements";
import { isSpecialKey, SPACE } from "./symbols";

/**
 * The layouts the site provides, listed in layouts/layouts.json (v2 specs). Kawamashi adds one with a pull request:
 * the .toml file, its replacements if any, and an entry in the list. These functions read what the server loads.
 */

/** The names layouts.json gives the thumb keys. The home key of each thumb is the outer one (question 36 of the specs). */
export const presetThumbKeys = {
  leftHome: thumbKeyIds.leftOuter,
  leftSecondary: thumbKeyIds.leftInner,
  rightSecondary: thumbKeyIds.rightInner,
  rightHome: thumbKeyIds.rightOuter,
} as const;

const isOneCharacter = (value: string) => Array.from(value).length === 1;
const thumbFormat = 'must be one character, such as "E", or a list of the character and the one typed after the dead key, such as ["E", "ê"]';

/**
 * A thumb key of layouts.json: its character, alone or followed by the one the dead key gives with it (feedback on v2).
 * Without that second character, the key takes the one the .toml gives, if it draws the key (see `thumbKey`).
 */
const thumbSchema = z.union([z.string(), z.array(z.string())], { error: thumbFormat }).transform((value, ctx) => {
  const [char, dk, ...rest] = typeof value === "string" ? [value] : value;
  if (char === undefined || !isOneCharacter(char) || (dk !== undefined && !isOneCharacter(dk)) || rest.length > 0) {
    ctx.addIssue({ code: "custom", message: thumbFormat });
    return z.NEVER;
  }
  // The engine reads the dead key, Repeat, Magic and space only without the dead key (`buildKeyMap`).
  if (dk !== undefined && isSpecialKey(dk)) {
    ctx.addIssue({ code: "custom", message: `"${dk}" cannot be typed after the dead key: write a character instead` });
    return z.NEVER;
  }
  return { char, dk };
});
const fileName = (extension: "toml" | "json") =>
  z.string().regex(new RegExp(`^[\\w.-]+\\.${extension}$`), `must be a file name of the layouts folder, ending in .${extension}`);

const presetEntrySchema = z.strictObject({
  name: z.string().min(1).max(100),
  toml: fileName("toml"),
  replacements: fileName("json").optional(),
  corpus: z.enum(corpusNameList).optional(),
  /** The keyboard shape to select with the layout (feedback on v2); left out, the current one stays. */
  keyboard: z.enum(shapeIds).optional(),
  thumbs: z
    .strictObject({
      leftHome: thumbSchema.optional(),
      leftSecondary: thumbSchema.optional(),
      rightSecondary: thumbSchema.optional(),
      rightHome: thumbSchema.optional(),
    })
    .default({}),
});

export type PresetEntry = z.infer<typeof presetEntrySchema>;
type Thumb = z.infer<typeof thumbSchema>;

/** A layout ready for the map: what the browser receives. */
export type Preset = {
  /** The .toml file name without its extension: unique in the folder. */
  id: string;
  name: string;
  layout: Layout;
  replacements: Replacements;
  replacementsName: string | null;
  /** The corpus to select with the layout (field "corpus"); null keeps the current one. */
  corpus: CorpusLanguage | null;
  /** The keyboard shape to select with the layout (field "keyboard"); null keeps the current one. */
  shapeId: ShapeId | null;
};

/** A problem in the folder, written for a contributor: it names the file and the field to fix. */
export type PresetResult<T> = { ok: true; value: T } | { ok: false; problem: string };

export const presetListFile = "layouts.json";

export function parsePresetList(source: string): PresetResult<PresetEntry[]> {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (error) {
    return { ok: false, problem: `${presetListFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = z.array(presetEntrySchema).min(1).safeParse(json);
  if (!parsed.success) {
    // Entries counted from 1, with their name, as a contributor reads the file.
    const issues = parsed.error.issues.map((issue) => {
      const [index, ...field] = issue.path;
      if (typeof index !== "number") return issue.message;
      const name = (json as Array<{ name?: unknown }>)[index]?.name;
      const entry = `entry ${index + 1}${typeof name === "string" ? ` (${name})` : ""}`;
      return `${entry}${field.length > 0 ? `, ${field.join(".")}` : ""}: ${issue.message}`;
    });
    return { ok: false, problem: `${presetListFile}: ${issues.join("; ")}` };
  }
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    if (seen.has(entry.toml)) return { ok: false, problem: `${presetListFile}: "${entry.toml}" is listed twice` };
    seen.add(entry.toml);
  }
  return { ok: true, value: parsed.data };
}

/**
 * What a thumb key of layouts.json holds. Its first character brings the key the .toml draws at the far left of the
 * bottom row when it is that key's base or Shift character ("E" gives E, ê and Ê on Propergol), and space brings the
 * space key with its dead key characters from [spacebar]. A letter comes with its capital; any other character, Magic,
 * Repeat or the dead key for instance, sits alone in the base zone. A second character replaces what the dead key
 * types with the key, whatever the .toml says.
 */
function thumbKey({ char, dk }: Thumb, fromToml: KeyChars | undefined, space: KeyChars | undefined): KeyChars {
  let chars: KeyChars;
  if (char === SPACE) chars = space ?? { base: SPACE };
  else if (fromToml && (char === fromToml.base || char === fromToml.shift || char.toLowerCase() === fromToml.base)) chars = fromToml;
  else if (isPair(char.toLowerCase(), char.toUpperCase())) chars = { base: char.toLowerCase(), shift: char.toUpperCase() };
  else chars = { base: char };
  if (dk === undefined) return chars;
  // The whole dead key layer is replaced; the capital of a letter comes back with `completeLayoutPairs`.
  const result: KeyChars = { ...chars, dk };
  delete result.dkShift;
  return result;
}

export function buildPreset(entry: PresetEntry, tomlSource: string, replacementsSource: string | null): PresetResult<Preset> {
  const imported = importKalamine(tomlSource, "split40");
  if (!imported.ok) {
    const detail = imported.problem.kind === "unreadable" ? imported.problem.detail : imported.problem.kind;
    return { ok: false, problem: `${entry.toml} could not be read: ${detail}` };
  }

  const duplicates = findBlockingDuplicates(imported.layout);
  if (duplicates.length > 0) {
    const chars = [...new Set(duplicates.map((duplicate) => duplicate.char))].join(" ");
    return { ok: false, problem: `${entry.toml}: ${chars} appear on several keys of the main pad` };
  }

  // Every thumb key comes from the list, even the one the .toml fills: its character may belong on another thumb.
  const keys = { ...imported.layout.keys };
  const fromToml = keys[thumbKeyIds.leftOuter];
  const space = keys[thumbKeyIds.rightOuter];
  for (const id of Object.values(thumbKeyIds)) delete keys[id];
  for (const [name, thumb] of Object.entries(entry.thumbs)) {
    if (thumb !== undefined) keys[presetThumbKeys[name as keyof typeof presetThumbKeys]] = thumbKey(thumb, fromToml, space);
  }

  let replacements = emptyReplacements;
  if (entry.replacements !== undefined) {
    if (replacementsSource === null) return { ok: false, problem: `${entry.replacements} is missing from the layouts folder` };
    const parsed = parseReplacements(replacementsSource);
    if (!parsed.ok) return { ok: false, problem: `${entry.replacements}: ${parsed.detail}` };
    replacements = parsed.replacements;
  }

  return {
    ok: true,
    value: {
      id: entry.toml.replace(/\.toml$/, ""),
      name: entry.name,
      // Read on the 40-key board, so that the outer keys are there if the visitor switches to it.
      layout: completeLayoutPairs({ name: entry.name, shapeId: entry.keyboard ?? "split40", keys }),
      replacements,
      replacementsName: entry.replacements ?? null,
      corpus: entry.corpus === undefined ? null : corpusNames[entry.corpus],
      shapeId: entry.keyboard ?? null,
    },
  };
}
