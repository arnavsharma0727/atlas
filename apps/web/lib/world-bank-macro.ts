import type { ResearchEvidence } from "./research-brief";

export type WorldBankIndicator = {
  code: string;
  label: string;
  unit: string;
  terms: RegExp;
};

/**
 * Deliberately narrow concept map. The World Bank's general metadata search is
 * too broad to make arbitrary market-topic matches meaningful.
 */
export const WORLD_BANK_INDICATORS: readonly WorldBankIndicator[] = [
  { code: "FP.CPI.TOTL.ZG", label: "Inflation, consumer prices (annual %)", unit: "% annual change", terms: /(?:\binflation\b|\bcpi\b|consumer price|cost of living|인플레이션|물가상승|消費者物価|インフレ|inflation|precios al consumidor|inflação|inflation|teuerung)/iu },
  { code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth (annual %)", unit: "% annual change", terms: /(?:\bgdp growth\b|economic growth|gross domestic product growth|경제성장|경제 성장|国内総生産.*成長|経済成長|crecimiento económico|crescimento econômico|croissance économique|wirtschaftswachstum)/iu },
  { code: "SL.UEM.TOTL.ZS", label: "Unemployment, total (% of total labor force)", unit: "% of labor force", terms: /(?:\bunemployment\b|jobless|labor market|labour market|실업률|失業率|desempleo|desemprego|chômage|arbeitslosigkeit)/iu },
];

const countryCodes: Readonly<Record<string, string>> = {
  US: "USA", KR: "KOR", JP: "JPN", DE: "DEU", FR: "FRA", BR: "BRA", IN: "IND", ES: "ESP",
};

export function worldBankIndicatorForQuery(query: string): WorldBankIndicator | null {
  return WORLD_BANK_INDICATORS.find(({ terms }) => terms.test(query)) ?? null;
}

export async function searchWorldBankMacro(
  query: string,
  selectedCountry: string,
  fetcher: typeof fetch = fetch,
): Promise<ResearchEvidence[]> {
  const indicator = worldBankIndicatorForQuery(query);
  if (!indicator) return [];
  const country = countryCodes[selectedCountry];
  if (!country) throw new Error("World Bank context requires one of Atlas's supported country lenses.");

  const countryList = [...new Set(["USA", country, "WLD"])];
  const endpoint = new URL(`https://api.worldbank.org/v2/country/${countryList.join(";")}/indicator/${indicator.code}`);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("mrnev", "3");
  endpoint.searchParams.set("date", `${new Date().getUTCFullYear() - 6}:${new Date().getUTCFullYear()}`);
  endpoint.searchParams.set("per_page", "100");
  const response = await fetcher(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`World Bank API returned HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) throw new Error("World Bank API returned an unexpected response.");

  const requested = new Set(countryList);
  const observations = payload[1] as unknown[];
  return observations.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const countryRow = row.country && typeof row.country === "object" ? row.country as Record<string, unknown> : null;
    const indicatorRow = row.indicator && typeof row.indicator === "object" ? row.indicator as Record<string, unknown> : null;
    const iso3 = row.countryiso3code;
    const name = countryRow?.value;
    const year = row.date;
    const number = typeof row.value === "number" ? row.value : typeof row.value === "string" ? Number(row.value) : NaN;
    if (typeof iso3 !== "string" || !requested.has(iso3) || typeof name !== "string" ||
      typeof year !== "string" || !/^\d{4}$/.test(year) || Number(year) > new Date().getUTCFullYear() ||
      row.obs_status === "F" || !Number.isFinite(number) ||
      indicatorRow?.id !== indicator.code) return [];

    const url = `https://api.worldbank.org/v2/country/${iso3}/indicator/${indicator.code}?format=json&date=${year}`;
    return [{
      id: `world-bank:${indicator.code}:${iso3}:${year}`,
      title: `${name} · ${indicator.label} · ${year}`,
      url,
      source: "World Bank · World Development Indicators",
      evidenceClass: "official statistical data" as const,
      language: "Not applicable · statistical series",
      timeLabel: "Observation year",
      timeValue: new Date(Date.UTC(Number(year), 11, 31)).toISOString(),
      context: `${number.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${indicator.unit}. Annual national/aggregate indicator; latest available year may differ by geography and may lag current conditions. This is official statistical context, not a measure of online discussion, investor opinion, or a real-time market price.`,
      attribution: "World Bank, World Development Indicators · CC BY 4.0",
      attributionUrl: "https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators",
      licenseName: "Creative Commons Attribution 4.0 International",
      licenseUrl: "https://datacatalog.worldbank.org/public-licenses",
      sourceOperatorKey: "world-bank-wdi",
      sourceOperatorLabel: "World Bank · World Development Indicators",
    }];
  });
}
