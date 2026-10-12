import { hasMarketSignalTerms } from "./market-summary";

const PRICE_CONTEXT: Record<string, string> = {
  en: "prices", ko: "가격", ja: "価格", de: "Preise", fr: "prix", pt: "preços", es: "precios", hi: "कीमत",
};

/** One original phrase plus, where useful, one transparent price-context supplement. */
export function marketDiscussionQueries(input: string, language: string): string[] {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  const cue = PRICE_CONTEXT[language];
  if (!cue || hasMarketSignalTerms({ excerpt: query, language })) return [query];
  const supplement = `${query} ${cue}`;
  return supplement.length <= 100 ? [query, supplement] : [query];
}

export const MARKET_QUERY_PLAN_NOTE = "Bluesky keeps the original phrase and may add one visible price-context query when no recognized market term is present. This can recover purchase/pricing discussion but biases the supplemental sample toward prices; it is not a complete view of market interests. Each query's results remain labeled and duplicate originals are collapsed, not counted as extra community agreement.";
