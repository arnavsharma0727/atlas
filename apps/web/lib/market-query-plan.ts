import { hasMarketSignalTerms } from "./market-summary";

const PRICE_CONTEXT: Record<string, string> = {
  en: "prices", ko: "가격", ja: "価格", de: "Preise", fr: "prix", pt: "preços", es: "precios", hi: "कीमत",
};

const REVIEWED_SECTOR_ALTERNATES: Record<string, Record<string, string>> = {
  en: { "solar panels": "photovoltaics", "solar panel": "photovoltaics", "solar modules": "photovoltaics" },
  de: { solarmodule: "Photovoltaik", solarmodul: "Photovoltaik" },
};

/** One original phrase plus at most two disclosed, bounded discovery supplements. */
export function marketDiscussionQueries(input: string, language: string): string[] {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  const cue = PRICE_CONTEXT[language];
  const result = [query];
  if (cue && !hasMarketSignalTerms({ excerpt: query, language })) {
    const supplement = `${query} ${cue}`;
    if (supplement.length <= 100) result.push(supplement);
  }
  const alternate = REVIEWED_SECTOR_ALTERNATES[language]?.[query.normalize("NFKC").toLocaleLowerCase()];
  if (alternate && !result.some((item) => item.toLocaleLowerCase() === alternate.toLocaleLowerCase())) result.push(alternate);
  return result;
}

export const MARKET_QUERY_PLAN_NOTE = "Bluesky keeps the original phrase and may add one visible price-context query when no recognized market term is present. A few reviewed sector terms also have one labeled adjacent-wording query (for example, solar panels / photovoltaics); broader wording can include adjacent rather than identical businesses. Supplements can improve discovery but bias the sample; they are not a complete view. Each query's results remain labeled and duplicate originals are collapsed, not counted as extra community agreement.";
