import type { ResearchEvidence } from "./research-brief";

export type EiaEnergySeries = {
  id: "RWTC" | "RBRTE" | "RNGWHHD";
  label: string;
  unit: string;
  route: string;
  chartUrl: string;
};

const WTI_BRENT: readonly EiaEnergySeries[] = [
  { id: "RWTC", label: "Cushing, Oklahoma WTI crude spot", unit: "USD per barrel", route: "petroleum/pri/spt/data/", chartUrl: "https://www.eia.gov/opendata/browser/petroleum/pri/spt?frequency=daily&data=value&facets=series&series=RWTC" },
  { id: "RBRTE", label: "Europe Brent crude spot", unit: "USD per barrel", route: "petroleum/pri/spt/data/", chartUrl: "https://www.eia.gov/opendata/browser/petroleum/pri/spt?frequency=daily&data=value&facets=series&series=RBRTE" },
];
const HENRY_HUB: EiaEnergySeries = {
  id: "RNGWHHD",
  label: "Henry Hub natural gas spot",
  unit: "USD per million Btu",
  route: "natural-gas/pri/fut/data/",
  chartUrl: "https://www.eia.gov/opendata/browser/natural-gas/pri/fut?frequency=daily&data=value&facets=series&series=RNGWHHD",
};
const ALL_ENERGY_SERIES = [...WTI_BRENT, HENRY_HUB] as const;

/** Conservative concept map: never call EIA for a generic company or unrelated market query. */
export function eiaSeriesForQuery(query: string): readonly EiaEnergySeries[] {
  if (/(?:\b(?:olive|vegetable|cooking|palm|soybean) oil\b|식용유|オリーブオイル|食用油)/iu.test(query)) return [];
  if (/(?:\benergy prices?\b|\benergy market\b|에너지 가격|エネルギー価格|precios de energía|preços de energia|énergie prices?)/iu.test(query)) return ALL_ENERGY_SERIES;
  if (/(?:\bnatural gas\b|\bhenry hub\b|천연가스|天然ガス|gas natural|gás natural|gaz naturel|erdgas)/iu.test(query)) return [HENRY_HUB];
  if (/(?:\bcrude(?: oil)?\b|\bwt[ií]\b|\bbrent\b|oil price|petroleum prices?|원유|유가|原油|油価|precios del petróleo|preço do petróleo|prix du pétrole|rohöl)/iu.test(query)) return WTI_BRENT;
  return [];
}

type EiaApiRow = Record<string, unknown>;

/** Fetches only the explicitly mapped EIA series; the API key is server-only and never returned. */
export async function searchEiaEnergyPrices(
  query: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ResearchEvidence[]> {
  const selected = eiaSeriesForQuery(query);
  if (!selected.length) return [];
  if (!apiKey.trim()) throw new Error("EIA_API_KEY is not configured.");
  const routeGroups = new Map<string, EiaEnergySeries[]>();
  for (const series of selected) routeGroups.set(series.route, [...(routeGroups.get(series.route) ?? []), series]);
  const output: ResearchEvidence[] = [];
  for (const [route, seriesGroup] of routeGroups) {
    const endpoint = new URL(`https://api.eia.gov/v2/${route}`);
    endpoint.searchParams.set("frequency", "daily");
    endpoint.searchParams.set("data[0]", "value");
    for (const { id } of seriesGroup) endpoint.searchParams.append("facets[series][]", id);
    endpoint.searchParams.set("sort[0][column]", "period");
    endpoint.searchParams.set("sort[0][direction]", "desc");
    endpoint.searchParams.set("length", "5");
    endpoint.searchParams.set("api_key", apiKey.trim());
    const response = await fetcher(endpoint, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(response.status === 429
      ? "EIA rate limit reached; try again later."
      : `EIA API returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const data = payload && typeof payload === "object" && "response" in payload && payload.response && typeof payload.response === "object" && "data" in payload.response
      ? payload.response.data
      : null;
    if (!Array.isArray(data)) {
      const errorCode = payload && typeof payload === "object" && "code" in payload ? String(payload.code) : "";
      throw new Error(errorCode === "api_key_invalid" ? "EIA API key was rejected." : "EIA API returned an unexpected response.");
    }
    const known = new Map(seriesGroup.map((series) => [series.id, series]));
    const perSeries = new Map<string, ResearchEvidence[]>();
    for (const value of data as EiaApiRow[]) {
      if (!value || typeof value !== "object") continue;
      const seriesId = typeof value.series === "string" ? value.series : "";
      const series = known.get(seriesId as EiaEnergySeries["id"]);
      const period = typeof value.period === "string" ? value.period : "";
      const number = typeof value.value === "number" ? value.value : typeof value.value === "string" ? Number(value.value) : NaN;
      const observationTime = Date.parse(`${period}T00:00:00Z`);
      const units = typeof value["value-units"] === "string" ? value["value-units"] : "";
      if (!series || !/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(observationTime) || observationTime > now ||
        !Number.isFinite(number) || units.length > 40) continue;
      const evidence: ResearchEvidence = {
        id: `eia:${series.id}:${period}`,
        title: `U.S. energy benchmark · ${series.label} · ${number.toFixed(2)} ${series.unit} · ${period}`,
        url: series.chartUrl,
        source: "U.S. Energy Information Administration (EIA)",
        evidenceClass: "official statistical data",
        language: "Not applicable · statistical series",
        timeLabel: "Observation date",
        timeValue: new Date(observationTime).toISOString(),
        context: `EIA reports ${number.toFixed(2)} ${series.unit} (${units || series.unit}) for this daily U.S. benchmark. It is not a price for the selected country, a global spot quote, an investment return, or evidence of online discussion. EIA series may be revised and may not update on weekends or holidays.`,
        attribution: "U.S. Energy Information Administration (EIA) · public-domain U.S. government data",
        attributionUrl: "https://www.eia.gov/about/copyrights_reuse.php",
        licenseName: "U.S. government public-domain data",
        licenseUrl: "https://www.eia.gov/about/copyrights_reuse.php",
        sourceOperatorKey: "eia",
        sourceOperatorLabel: "U.S. Energy Information Administration",
      };
      const records = perSeries.get(series.id) ?? [];
      if (records.length < 5 && !records.some((item) => item.timeValue === evidence.timeValue)) records.push(evidence);
      perSeries.set(series.id, records);
    }
    for (const series of seriesGroup) output.push(...(perSeries.get(series.id) ?? []));
  }
  return output;
}
