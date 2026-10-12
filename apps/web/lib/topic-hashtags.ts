/** Preserve compound subjects; split words can change a market into an unrelated hashtag. */
const COMPOUND_SUBJECTS: readonly [RegExp, string][] = [
  [/\bsolar\s+panels?\b/giu, "SolarPanels"],
  [/\bsolar\s+modules?\b/giu, "SolarModules"],
  [/\bvoitures?\s+électriques?\b/giu, "VoitureElectrique"],
  [/\bcarros?\s+elétricos?\b/giu, "CarroEletrico"],
  [/\bcoches?\s+eléctricos?\b/giu, "CocheElectrico"],
  [/\bnatural\s+gas\b/giu, "NaturalGas"],
  [/\belectric\s+vehicles?\b/giu, "ElectricVehicles"],
  [/\bartificial\s+intelligence\b/giu, "ArtificialIntelligence"],
  [/\brare\s+earths?\b/giu, "RareEarths"],
  [/\breal\s+estate\b/giu, "RealEstate"],
  [/\binterest\s+rates?\b/giu, "InterestRates"],
  [/\bgas\s+natural\b/giu, "GasNatural"],
  [/\bgás\s+natural\b/giu, "GásNatural"],
  [/\bgaz\s+naturel\b/giu, "GazNaturel"],
  [/천연\s+가스/gu, "천연가스"],
  [/प्राकृतिक\s+गैस/gu, "प्राकृतिकगैस"],
];

/** Keep vowel signs/combining marks intact, notably in Hindi and decomposed Latin text. */
export function isValidTopicHashtag(value: string): boolean {
  return /^[\p{L}\p{N}\p{M}_-]{1,50}$/u.test(value) && /[\p{L}\p{N}]/u.test(value);
}

/** Build at most three explicit tags, not an unbounded synonym or full-text search. */
export function topicHashtags(topic: string): string[] {
  const stopWords = new Set(["and", "or", "the", "for", "with", "to", "in", "of", "by"]);
  const genericMarketTags = new Set([
    "business", "chain", "company", "companies", "demand", "economic", "economy", "earnings", "finance", "financial",
    "industry", "interest", "investor", "investors", "market", "markets", "news", "price", "prices", "rate", "rates",
    "revenue", "sector", "share", "shares", "stock", "stocks", "supply", "update",
  ]);
  let normalizedTopic = topic.normalize("NFKC").replace(/\bS\s*&\s*P\s*500\b/giu, "SP500");
  for (const [pattern, tag] of COMPOUND_SUBJECTS) normalizedTopic = normalizedTopic.replace(pattern, tag);
  const parts = normalizedTopic.trim().split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}\p{M}_-]/gu, ""))
    .filter(isValidTopicHashtag);
  const candidates = parts.length > 1
    ? parts.filter((part) => !stopWords.has(part.toLocaleLowerCase()) && (Array.from(part).length > 1 || /^\p{N}+$/u.test(part)))
    : parts.length ? [parts.join("")] : [];
  const specific = candidates.filter((part) => !genericMarketTags.has(part.toLocaleLowerCase()));
  const selected = specific.length ? specific : candidates;
  const unique = [...new Set(selected.map((part) => part.normalize("NFKC").toLocaleLowerCase()))];
  return unique.slice(0, 3).map((part) => {
    const original = selected.find((candidate) => candidate.normalize("NFKC").toLocaleLowerCase() === part)!;
    return original === original.toLocaleUpperCase() || COMPOUND_SUBJECTS.some(([, tag]) => tag === original)
      ? original
      : original.charAt(0).toLocaleUpperCase() + original.slice(1);
  });
}
