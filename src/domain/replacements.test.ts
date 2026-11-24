import { describe, expect, it } from "vitest";
import { parseReplacements, replacementsFor } from "./replacements";

describe("corpusRestriction (feedback on v2)", () => {
  const source = JSON.stringify({
    essentialCorrections: [
      { text: "'", keys: "$", corpusRestriction: "french" },
      { text: "qu", keys: "q" },
    ],
    optionalCorrections: [{ text: "the", keys: "t#", corpusRestriction: "english" }],
  });
  const parsed = parseReplacements(source);
  if (!parsed.ok) throw new Error(parsed.detail);
  const { replacements } = parsed;

  it("keeps the rules of the corpus and the unrestricted ones", () => {
    expect(replacementsFor(replacements, "fr")).toEqual({
      essentialCorrections: [replacements.essentialCorrections[0], replacements.essentialCorrections[1]],
      optionalCorrections: [],
    });
    expect(replacementsFor(replacements, "en").essentialCorrections.map((rule) => rule.text)).toEqual(["qu"]);
    expect(replacementsFor(replacements, "en").optionalCorrections.map((rule) => rule.text)).toEqual(["the"]);
  });

  it("keeps every rule for the personal corpus", () => {
    expect(replacementsFor(replacements, "personal")).toBe(replacements);
  });

  it("refuses an unknown corpus name", () => {
    const refused = parseReplacements('{ "essentialCorrections": [{ "text": "a", "keys": "b", "corpusRestriction": "german" }] }');
    expect(!refused.ok && refused.detail).toMatch(/^essentialCorrections\.0\.corpusRestriction: .*"french"/);
  });
});
