import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreset, parsePresetList, presetListFile, type Preset } from "./presets";

// The real folder: a contributor who breaks a file learns here which file and which field to fix.
const folder = join(process.cwd(), "layouts");
const read = (file: string) => readFileSync(join(folder, file), "utf8");

const list = parsePresetList(read(presetListFile));

function load(toml: string): Preset {
  if (!list.ok) throw new Error(list.problem);
  const entry = list.value.find((item) => item.toml === toml);
  if (!entry) throw new Error(`${toml} is not listed in ${presetListFile}`);
  const built = buildPreset(entry, read(entry.toml), entry.replacements ? read(entry.replacements) : null);
  if (!built.ok) throw new Error(built.problem);
  return built.value;
}

describe("the layouts folder", () => {
  it(`has a valid ${presetListFile}`, () => {
    expect(list.ok ? "valid" : list.problem).toBe("valid");
  });

  for (const entry of list.ok ? list.value : []) {
    it(`loads ${entry.name} (${entry.toml})`, () => {
      for (const file of [entry.toml, entry.replacements]) {
        if (file !== undefined) expect(existsSync(join(folder, file)) ? file : `${file} is listed in ${presetListFile} but missing from the layouts folder`).toBe(file);
      }
      const built = buildPreset(entry, read(entry.toml), entry.replacements ? read(entry.replacements) : null);
      expect(built.ok ? "loaded" : built.problem).toBe("loaded");
    });
  }
});

/** Builds a layout of the folder from an entry written as in layouts.json, with these extra fields. */
function fromJson(fields: Record<string, unknown>, toml = "propergol.toml"): Preset {
  const parsed = parsePresetList(JSON.stringify([{ name: "Test", toml, ...fields }]));
  if (!parsed.ok) throw new Error(parsed.problem);
  const built = buildPreset(parsed.value[0]!, read(toml), null);
  if (!built.ok) throw new Error(built.problem);
  return built.value;
}

const thumbs = (toml: string, value: Record<string, unknown>) => fromJson({ thumbs: value }, toml).layout.keys;

describe("buildPreset", () => {
  it("places Propergol's thumbs, replacements and corpus", () => {
    const preset = load("propergol.toml");
    expect(preset.layout.keys.tlo).toMatchObject({ base: "e", shift: "E", dk: "ê" });
    expect(preset.layout.keys.tli).toEqual({ base: "#" });
    expect(preset.layout.keys.tri).toEqual({ base: "$" });
    expect(preset.layout.keys.tro).toMatchObject({ base: " ", dk: "_" });
    expect(preset.replacementsName).toBe("propergol.json");
    expect(preset.replacements.essentialCorrections.length).toBeGreaterThan(0);
    expect(preset.corpus).toBe("fr");
  });

  it("leaves a thumb key empty when the list does not describe it (question 43 of the specs)", () => {
    const preset = load("ergol.toml");
    expect(preset.layout.keys.tlo).toBeUndefined();
    expect(preset.layout.keys.tli).toBeUndefined();
    expect(preset.layout.keys.tri).toBeUndefined();
    // Ergo-L types the apostrophe with the dead key and space; the curly one is read as straight.
    expect(preset.layout.keys.tro).toMatchObject({ base: " ", dk: "'" });
    expect(preset.replacementsName).toBeNull();
  });

  it("puts a character the .toml does not draw alone on its thumb key", () => {
    expect(thumbs("ergol.toml", { leftHome: "*" }).tlo).toEqual({ base: "*" });
  });

  it("gives a letter the .toml does not draw its capital", () => {
    expect(thumbs("ergol.toml", { leftHome: "E" }).tlo).toEqual({ base: "e", shift: "E" });
  });

  it("takes the dead key character of a thumb key from the list, over the .toml's (feedback on v2)", () => {
    const keys = thumbs("propergol.toml", { leftHome: ["E", "é"], leftSecondary: ["#", "à"], rightSecondary: ["$", "'"], rightHome: [" ", "-"] });
    expect(keys.tlo).toEqual({ base: "e", shift: "E", dk: "é", dkShift: "É" });
    expect(keys.tli).toEqual({ base: "#", dk: "à", dkShift: "À" });
    expect(keys.tri).toEqual({ base: "$", dk: "'" });
    expect(keys.tro).toEqual({ base: " ", dk: "-" });
  });

  it("keeps the .toml's dead key character when the list gives one character, alone or in a list", () => {
    const keys = thumbs("propergol.toml", { leftHome: ["E"], rightHome: " " });
    expect(keys.tlo).toMatchObject({ base: "e", shift: "E", dk: "ê" });
    expect(keys.tro).toMatchObject({ base: " ", dk: "_" });
  });

  it("selects the keyboard its entry names, and none without the field (feedback on v2)", () => {
    expect(fromJson({ keyboard: "split34" }).shapeId).toBe("split34");
    expect(fromJson({ keyboard: "split34" }).layout.shapeId).toBe("split34");
    // Read on the 40-key board all the same: its outer keys show if the visitor switches to it.
    expect(fromJson({ keyboard: "split34" }).layout.keys.k10).toBeDefined();
    expect(fromJson({}).shapeId).toBeNull();
  });

  it("names the missing replacements file", () => {
    const built = buildPreset({ name: "Test", toml: "ergol.toml", replacements: "nowhere.json", thumbs: {} }, read("ergol.toml"), null);
    expect(!built.ok && built.problem).toBe("nowhere.json is missing from the layouts folder");
  });
});

describe("parsePresetList", () => {
  it("names an unknown thumb key, so that a typo does not go unnoticed", () => {
    const parsed = parsePresetList('[{ "name": "A", "toml": "a.toml", "thumbs": { "rightOuter": " " } }]');
    expect(!parsed.ok && parsed.problem).toBe('layouts.json: entry 1 (A), thumbs: Unrecognized key: "rightOuter"');
  });

  it("refuses a thumb key with more than one character, or more than two in a list", () => {
    const format = 'must be one character, such as "E", or a list of the character and the one typed after the dead key, such as ["E", "ê"]';
    for (const value of ['"ab"', '["E", "ê", "Ê"]', "[]", '["E", "êe"]', "3"]) {
      const parsed = parsePresetList(`[{ "name": "A", "toml": "a.toml", "thumbs": { "rightHome": ${value} } }]`);
      expect(!parsed.ok && parsed.problem).toBe(`layouts.json: entry 1 (A), thumbs.rightHome: ${format}`);
    }
  });

  it("refuses a special key after the dead key", () => {
    const parsed = parsePresetList('[{ "name": "A", "toml": "a.toml", "thumbs": { "rightHome": [" ", "$"] } }]');
    expect(!parsed.ok && parsed.problem).toBe('layouts.json: entry 1 (A), thumbs.rightHome: "$" cannot be typed after the dead key: write a character instead');
  });

  it("names an unknown keyboard", () => {
    const parsed = parsePresetList('[{ "name": "A", "toml": "a.toml", "keyboard": "Split, 34" }]');
    expect(!parsed.ok && parsed.problem).toMatch(/^layouts.json: entry 1 \(A\), keyboard: .*"split34"/);
  });

  it("refuses a file listed twice", () => {
    const parsed = parsePresetList('[{ "name": "A", "toml": "a.toml" }, { "name": "B", "toml": "a.toml" }]');
    expect(!parsed.ok && parsed.problem).toBe('layouts.json: "a.toml" is listed twice');
  });

  it("refuses a path outside the layouts folder", () => {
    const parsed = parsePresetList('[{ "name": "A", "toml": "../secret.toml" }]');
    expect(parsed.ok).toBe(false);
  });
});
