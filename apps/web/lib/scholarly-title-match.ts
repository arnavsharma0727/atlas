const STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Preserve attached vowel signs/combining marks; do not create mark-only query terms. */
export function scholarlySearchTokens(value: string): string[] {
  return value.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
}

/** Lexical title screen, not semantic relevance, stemming, translation, or a language classifier. */
export function matchesScholarlyTitle(title: string, query: string): boolean {
  const normalizedTitle = title.normalize("NFKC").toLocaleLowerCase();
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().trim();
  if (!normalizedQuery) return false;
  if (CJK.test(normalizedQuery)) return normalizedTitle.includes(normalizedQuery);
  const terms = scholarlySearchTokens(normalizedQuery).filter((term) => Array.from(term).length > 1 && !STOP_WORDS.has(term));
  if (!terms.length) return normalizedTitle.includes(normalizedQuery);
  const titleTerms = new Set(scholarlySearchTokens(normalizedTitle));
  return terms.every((term) => titleTerms.has(term));
}

export const SCHOLARLY_TITLE_MATCH_NOTE = " · Exact normalized title words (CJK: full phrase); English stop words ignored, no stemming or translation. Synonym/inflection matches can be missed.";
