import { parse } from "csv-parse/sync";
import type { ResearchEvidence } from "./research-brief";
import { marketCountry } from "./market-countries";

const API = "https://stats.bis.org/api/v1/data/WS_EER";
const PORTAL = "https://data.bis.org/topics/EER/BIS%2CWS_EER%2C1.0";
const BIS_SOURCE = "Bank for International Settlements (BIS)";
const FX_QUERY = /(?:\b(?:fx|forex|foreign exchange|exchange rate|exchange rates|currency|currencies|dollar|euro|yen|won|rupee|brazilian real|pound|yuan|renminbi|usd|eur|jpy|krw|inr|brl|gbp|cny)\b|환율|원화|엔화|為替|通貨|환전|wechselkurs|währung|cambio|divisa|câmbio|moeda|taux de change|devise)/iu;
const COUNTRY_ISO2: Readonly<Record<string, string>> = {
  US: "US", KR: "KR", JP: "JP", DE: "DE", FR: "FR", BR: "BR", IN: "IN", ES: "ES",
};

export type BisEerCoverage = {
  evidence: ResearchEvidence[];
  missingSeries: string[];
  staleSeries: string[];
  failedAreas: string[];
};

export function bisEerAppliesToQuery(query: string): boolean {
  return FX_QUERY.test(query.normalize("NFKC"));
}

/** Fetches only BIS monthly broad-basket indices; this is official context, not opinion. */
export async function searchBisEffectiveExchangeRates(
  query: string,
  selectedCountry: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<BisEerCoverage> {
  if (!bisEerAppliesToQuery(query)) return { evidence: [], missingSeries: [], staleSeries: [], failedAreas: [] };
  const country = marketCountry(selectedCountry);
  const selectedIso2 = COUNTRY_ISO2[country.code];
  if (!selectedIso2) throw new Error("BIS context is not configured for this country lens.");
  const areas = [...new Set(["US", selectedIso2])];
  const startPeriod = (new Date(now).getUTCFullYear() - 3) + "-01";
  const settled = await Promise.all(areas.map(async (area) => {
    try {
      const endpoint = new URL(API + "/M..B." + area + "/all");
      endpoint.searchParams.set("startPeriod", startPeriod);
      endpoint.searchParams.set("format", "csvfile");
      const response = await fetcher(endpoint, { headers: { accept: "text/csv" } });
      if (!response.ok) return { area, items: [], failed: true };
      const text = await response.text();
      if (text.length > 1_000_000) return { area, items: [], failed: true };
      return { area, items: parseBISCsv(text, area, new Date(now).toISOString().slice(0, 7)), failed: false };
    } catch {
      return { area, items: [], failed: true };
    }
  }));
  const series = settled.flatMap(({ items }) => items);
  const failedAreas = settled.filter(({ failed }) => failed).map(({ area }) => area);

  const bySeries = new Map(series.flat().map((item) => [item.area + ":" + item.type, item]));
  const countryName = (code: string) => code === "US" ? "United States" : country.name;
  const expected = areas.flatMap((area) => (["N", "R"] as const).map((type) => area + ":" + type));
  const missingSeries = expected.filter((key) => !bySeries.has(key) && !failedAreas.includes(key.split(":")[0]));
  const staleSeries: string[] = [];
  const evidence = expected.flatMap((key) => {
    const item = bySeries.get(key);
    if (!item) return [];
    const latest = item.observations.at(-1)!;
    const yearAgo = item.observations.find(({ period }) => period === previousYearPeriod(latest.period));
    const stale = now - Date.parse(latest.period + "-01T00:00:00Z") > 100 * 24 * 60 * 60 * 1000;
    if (stale) staleSeries.push(key);
    const label = item.type === "N" ? "Nominal" : "Real";
    const title = countryName(item.area) + " · " + label.toLocaleLowerCase() + " effective exchange rate (broad basket)";
    const yoyChange = yearAgo ? (latest.value / yearAgo.value - 1) * 100 : null;
    const movement = yoyChange === null
      ? " Twelve-month change unavailable because a matching observation was not returned."
      : " Twelve-month index change: " + formatNumber(yoyChange) + "% (" +
        (Math.abs(yoyChange) < 0.005 ? "approximately unchanged" : (yoyChange > 0 ? "appreciation" : "depreciation") + (item.type === "R" ? " in real terms" : " in nominal terms")) +
        " against the broad basket). This index alone does not indicate over- or undervaluation.";
    return [{
      id: "bis-eer:" + item.area + ":" + item.type + ":" + latest.period,
      title,
      url: PORTAL + "/M." + item.type + ".B." + item.area,
      source: BIS_SOURCE,
      evidenceClass: "official statistical data" as const,
      summaryEligible: false,
      language: "Not applicable",
      timeLabel: "Latest monthly observation",
      timeValue: latest.period,
      context: "Index " + formatNumber(latest.value) + " (2020 = 100)." + movement + " " +
        (item.type === "N" ? "Nominal" : "Real") +
        " effective rate is a trade-weighted broad-basket index, not a bilateral spot exchange rate. Country indices are each normalized to their own 2020 base and their levels should not be compared directly. " +
        (stale ? "Latest observation is more than 100 days old; check the publisher before relying on it." : ""),
      attribution: "Bank for International Settlements · Effective exchange rates (WS_EER)",
      attributionUrl: "https://data.bis.org/topics/EER",
      licenseName: "BIS permitted-use terms · attribution required",
      licenseUrl: "https://data.bis.org/help/legal",
      sourceOperatorKey: "bis-statistics",
      sourceOperatorLabel: BIS_SOURCE,
    }];
  });
  return { evidence, missingSeries, staleSeries, failedAreas };
}

function parseBISCsv(text: string, expectedArea: string, latestAllowedPeriod: string) {
  const records = parse(text, { columns: true, skip_empty_lines: true, bom: true, max_record_size: 20_000 }) as Array<Record<string, string>>;
  const headers = new Set(records.length ? Object.keys(records[0]) : []);
  if (!["REF_AREA", "EER_TYPE", "TIME_PERIOD", "OBS_VALUE"].every((header) => headers.has(header))) {
    throw new Error("BIS returned an unexpected data format.");
  }
  const items: Array<{ area: string; type: "N" | "R"; observations: Array<{ period: string; value: number }> }> = [];
  for (const type of ["N", "R"] as const) {
    const observations = records.flatMap((row) => {
      const period = row.TIME_PERIOD;
      const value = Number(row.OBS_VALUE);
      if (row.REF_AREA !== expectedArea || row.EER_TYPE !== type || !/^\d{4}-\d{2}$/u.test(period ?? "") || period > latestAllowedPeriod || !Number.isFinite(value) || value <= 0) return [];
      return [{ period, value }];
    }).sort((a, b) => a.period.localeCompare(b.period));
    if (observations.length) items.push({ area: expectedArea, type, observations });
  }
  return items;
}

function previousYearPeriod(period: string) {
  return (Number(period.slice(0, 4)) - 1) + period.slice(4);
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/u, "") : "not available";
}
