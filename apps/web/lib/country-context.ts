import type { ResearchSweepSourceResult } from "./research-sweep";

const countrySeries: Record<string, { iso3: string; currency: string }> = {
  US: { iso3: "USA", currency: "USD" }, KR: { iso3: "KOR", currency: "KRW" },
  JP: { iso3: "JPN", currency: "JPY" }, DE: { iso3: "DEU", currency: "EUR" },
  FR: { iso3: "FRA", currency: "EUR" }, BR: { iso3: "BRA", currency: "BRL" },
  IN: { iso3: "IND", currency: "INR" }, ES: { iso3: "ESP", currency: "EUR" },
};

type Evidence = ResearchSweepSourceResult["evidence"][number];
export type CountryContextFact = { sourceKey: string; item: Evidence; brief: string };

/** Select only a documented series for the chosen geography, never a language-derived country claim. */
export function selectedCountryContext(results: ResearchSweepSourceResult[], countryCode: string): CountryContextFact[] {
  const selected = Object.hasOwn(countrySeries, countryCode) ? countrySeries[countryCode] : undefined;
  if (!selected) return [];
  const selectedIso3 = selected.iso3;
  const currency = selected.currency;
  const pick = (sourceKey: string, matches: (item: Evidence) => boolean) => {
    const result = results.find(({ key, status }) => key === sourceKey && status === "complete");
    const item = result?.evidence.find((candidate) => (candidate.evidenceClass === "official statistical data" || candidate.evidenceClass === "official policy release") && matches(candidate));
    if (!item || !result) return null;
    const firstSentence = (item.context ?? "").match(/^.*?\.\s/u)?.[0]?.trim() ?? "";
    return { sourceKey: result.key, item, brief: firstSentence };
  };
  return [
    countryCode === "BR" ? pick("bcb-selic", (item) => item.id.startsWith("bcb-selic:432:")) : null,
    countryCode === "DE" || countryCode === "FR" || countryCode === "ES" ? pick("eurostat-industrial", (item) => item.id.startsWith(`eurostat-industrial:${countryCode}:`)) : null,
    countryCode === "US" ? pick("bls-us", (item) => item.id.startsWith("bls:")) : null,
    countryCode === "US" ? pick("fed-policy", (item) => item.id.startsWith("fed-policy:")) : null,
    currency && currency !== "EUR" ? pick("ecb-reference", (item) => item.id.startsWith(`ecb-reference:${currency}:`)) : null,
    pick("bis-effective-exchange", (item) => item.id.startsWith(`bis-eer:${countryCode}:N:`)),
    pick("world-bank-macro", (item) => item.id.includes(`:${selectedIso3}:`)),
  ].filter((item): item is CountryContextFact => !!item).slice(0, 3);
}
