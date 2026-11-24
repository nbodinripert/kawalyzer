/** The corpora the site provides. They stay on the server: only their identifiers reach the browser. */
export const corpusLanguages = ["fr", "en"] as const;
export type CorpusLanguage = (typeof corpusLanguages)[number];

/** The corpus the user imports, analysed in the browser: it never reaches the server (question 28 of the specs). */
export const PERSONAL_CORPUS = "personal";

/** What the "Corpus" list can select. */
export type CorpusId = CorpusLanguage | typeof PERSONAL_CORPUS;

/** How the layouts folder names the site's corpora (layouts.json and the replacements files): words a contributor reads. */
export const corpusNames = { french: "fr", english: "en" } as const satisfies Record<string, CorpusLanguage>;
export type CorpusName = keyof typeof corpusNames;
export const corpusNameList = Object.keys(corpusNames) as [CorpusName, ...CorpusName[]];
