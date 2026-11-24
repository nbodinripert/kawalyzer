import { z } from "zod";
import { corpusNameList, corpusNames, PERSONAL_CORPUS, type CorpusId } from "./corpora";

const charList = z.union([z.string(), z.array(z.string())]).transform((value) =>
  typeof value === "string" ? Array.from(value) : value,
);

const correction = z.object({
  text: z.string().min(1),
  keys: z.string(),
  /** The rule only applies to this corpus of the site: "french" or "english" (feedback on v2). */
  corpusRestriction: z.enum(corpusNameList).optional(),
});

const optionalCorrection = correction.extend({
  noLetterBefore: z.boolean().optional(),
  noLetterAfter: z.boolean().optional(),
  allowedBefore: charList.optional(),
  allowedAfter: charList.optional(),
});

const replacementsObject = z.object({
  essentialCorrections: z.array(correction).default([]),
  optionalCorrections: z.array(optionalCorrection).default([]),
});

export const replacementsSchema = replacementsObject;

export type Correction = z.infer<typeof correction>;
export type OptionalCorrection = z.infer<typeof optionalCorrection>;
export type Replacements = z.output<typeof replacementsObject>;

export const emptyReplacements: Replacements = { essentialCorrections: [], optionalCorrections: [] };

/**
 * The rules that apply to a corpus: a rule restricted to another corpus of the site is left out. The personal corpus
 * keeps every rule: the site cannot tell its language, and the visitor chose these replacements for their own text.
 */
export function replacementsFor(replacements: Replacements, corpus: CorpusId | undefined): Replacements {
  if (corpus === undefined || corpus === PERSONAL_CORPUS) return replacements;
  const applies = (rule: Correction) => rule.corpusRestriction === undefined || corpusNames[rule.corpusRestriction] === corpus;
  const { essentialCorrections, optionalCorrections } = replacements;
  if (essentialCorrections.every(applies) && optionalCorrections.every(applies)) return replacements;
  return { essentialCorrections: essentialCorrections.filter(applies), optionalCorrections: optionalCorrections.filter(applies) };
}

export type ParsedReplacements = { ok: true; replacements: Replacements } | { ok: false; detail: string };

export function parseReplacements(source: string): ParsedReplacements {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const result = replacementsSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, detail: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  return { ok: true, replacements: result.data };
}

export const analysisLevels = ["raw", "corrections", "clever"] as const;
export type AnalysisLevel = (typeof analysisLevels)[number];
