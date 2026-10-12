const WORD_EDGE = "[\\p{L}\\p{M}\\p{N}_]";
const words = (alternatives: string) => new RegExp(`(?<!${WORD_EDGE})(?:${alternatives})(?!${WORD_EDGE})`, "iu");
const INFLATION = words("inflation|deflation");
const EXPLICIT_NON_ECONOMIC = words("cosmic|cosmological|cosmology|quantum|scalar|inflaton|universe|spacetime|balloon|tyre|tire");
const ECONOMIC = words("economic|economics|economy|economies|macroeconomic|macroeconomics|microeconomic|monetary|fiscal|financial|finance|bank|banks|banking|CPI|PPI|HICP|GDP|prices?|wages?|unemployment|recession|households?|purchasing|cost.of.living|interest.rates?|inflation.targeting");
const normalize = (value: string) => value.normalize("NFKC");

/** Narrow wrong-sense guard, not a general semantic relevance classifier. */
export function needsEconomicInflationContext(query: string): boolean {
  const normalized = normalize(query);
  return INFLATION.test(normalized) && !EXPLICIT_NON_ECONOMIC.test(normalized);
}

export function matchesScholarlyContext(query: string, title: string, containerTitle = "", category = ""): boolean {
  if (!needsEconomicInflationContext(query)) return true;
  // An explicit physical sense in the title cannot be rescued by a broad journal/category.
  if (EXPLICIT_NON_ECONOMIC.test(normalize(title))) return false;
  return ECONOMIC.test(normalize(title)) || ECONOMIC.test(normalize(containerTitle)) || /^(?:econ|q-fin)\./u.test(category);
}

export function scholarlyContextNote(query: string): string {
  return needsEconomicInflationContext(query)
    ? " · Economic inflation/deflation context required in retained title, journal metadata, or arXiv category; explicit physical senses excluded. Conservative English-only disambiguation can omit relevant work; only the bounded upstream result set is screened."
    : "";
}
