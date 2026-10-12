import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ResearchEvidence } from "./research-brief";
import { LABOR_TERMS, officialDriverPlan } from "./official-driver-plan";

export type OfficialDriverResult = {
  key: string;
  label: string;
  window: string;
  evidence: ResearchEvidence[];
  providerReturnedCount?: number;
  status: "complete" | "partial" | "unavailable";
  coverageNote: string;
  error: string | null;
};

const EUROPE = new Set(["DE", "FR", "ES"]);
const GEO: Record<string, string> = { DE: "Germany", FR: "France", ES: "Spain" };

async function boundedText(response: Response, limit = 100_000): Promise<string> {
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new Error("Provider response exceeds size limit");
  const body = await response.text();
  if (body.length > limit) throw new Error("Provider response exceeds size limit");
  return body;
}

function officialItem(input: Omit<ResearchEvidence, "evidenceClass" | "language" | "summaryEligible">, evidenceClass: "official statistical data" | "official policy release" = "official statistical data"): ResearchEvidence {
  return { ...input, evidenceClass, language: "Not applicable · official data", summaryEligible: false };
}

function unavailable(key: string, label: string, window: string): OfficialDriverResult {
  return { key, label, window, evidence: [], status: "unavailable", error: `${label} is temporarily unavailable.`, coverageNote: "No data was inferred from a failed provider request." };
}

/** Broad industrial output is context, never a proxy for a named company or product segment. */
export async function searchEurostatIndustrial(country: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<OfficialDriverResult> {
  const key = "eurostat-industrial", label = "Eurostat · industrial production", window = "Monthly seasonally adjusted broad-industry index · latest observation";
  if (!EUROPE.has(country)) throw new Error("Eurostat industrial series is configured for Germany, France and Spain only.");
  try {
    const endpoint = new URL("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_inpr_m");
    for (const [param, value] of Object.entries({ geo: country, nace_r2: "B-D", indic_bt: "PRD", unit: "I21", s_adj: "SCA", lastTimePeriod: "4" })) endpoint.searchParams.set(param, value);
    const response = await fetcher(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    const body = JSON.parse(await boundedText(response)) as Record<string, unknown>;
    const dimensions = body.dimension as Record<string, { category?: { index?: Record<string, number> } }> | undefined;
    const expected = { freq: "M", indic_bt: "PRD", nace_r2: "B-D", s_adj: "SCA", unit: "I21", geo: country };
    if (!Array.isArray(body.id) || body.id.join(",") !== "freq,indic_bt,nace_r2,s_adj,unit,geo,time" ||
      !Array.isArray(body.size) || body.size.slice(0, 6).some((size) => size !== 1) ||
      Object.entries(expected).some(([dimension, code]) => dimensions?.[dimension]?.category?.index?.[code] !== 0)) {
      throw new Error("Unexpected Eurostat dimensions");
    }
    const values = body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : {};
    const time = dimensions?.time?.category?.index ?? {};
    const observations = Object.entries(time).flatMap(([month, index]) => {
      const value = values[String(index)];
      const date = Date.parse(`${month}-01T00:00:00Z`);
      return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && Number.isFinite(date) && date <= now && typeof value === "number" && Number.isFinite(value)
        ? [{ month, value }] : [];
    }).sort((a, b) => b.month.localeCompare(a.month));
    const latest = observations[0];
    if (!latest) return { key, label, window, evidence: [], providerReturnedCount: Object.keys(time).length, status: "partial", error: null, coverageNote: "The exact broad-industry series returned no usable, non-future observation." };
    const ageDays = Math.floor((now - Date.parse(`${latest.month}-01T00:00:00Z`)) / 86_400_000);
    const sourceUrl = endpoint.toString();
    return { key, label, window, providerReturnedCount: Object.keys(time).length, status: ageDays > 150 ? "partial" : "complete", error: null,
      coverageNote: `Broad industry (NACE B–D) only; not ${GEO[country]} company sales or output in the searched product. ${ageDays > 150 ? "This observation is more than five months old." : "Index publication lags the observation month."}`,
      evidence: [officialItem({ id: `eurostat-industrial:${country}:${latest.month}`, title: `${GEO[country]} · industrial production · ${latest.month}`, url: sourceUrl,
        source: "Eurostat", timeLabel: "Observation month", timeValue: latest.month,
        context: `${latest.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} index points (2021 = 100), seasonally and calendar adjusted. Broad industry, not company revenue or product demand.`,
        attribution: "Eurostat · modified extract of sts_inpr_m", attributionUrl: "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
        sourceOperatorKey: "eurostat", sourceOperatorLabel: "Eurostat" })] };
  } catch { return unavailable(key, label, window); }
}

/** Unregistered BLS v1 is tightly scoped; its public quota is only 25 calls/day. */
export async function searchBls(topic: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<OfficialDriverResult> {
  const key = "bls-us", label = "U.S. BLS · labor and prices", window = "Latest monthly U.S. series · unregistered API allowance";
  const series = LABOR_TERMS.test(topic)
    ? { id: "LNS14000000", name: "unemployment rate", unit: "% of labor force" }
    : { id: "CUUR0000SA0", name: "consumer price index", unit: "index points (1982–84 = 100)" };
  try {
    const endpoint = `https://api.bls.gov/publicAPI/v1/timeseries/data/${series.id}`;
    const response = await fetcher(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    const body = JSON.parse(await boundedText(response)) as { status?: unknown; Results?: { series?: { seriesID?: unknown; data?: unknown[] }[] } };
    if (body.status !== "REQUEST_SUCCEEDED") throw new Error("BLS did not accept the request");
    const rows = body.Results?.series?.find((item) => item.seriesID === series.id)?.data ?? [];
    const latest = rows.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const month = `${row.year}-${typeof row.period === "string" ? row.period.replace(/^M/, "") : ""}`;
      const value = typeof row.value === "string" ? Number(row.value) : NaN;
      const date = Date.parse(`${month}-01T00:00:00Z`);
      return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && Number.isFinite(date) && date <= now && Number.isFinite(value) ? [{ month, value }] : [];
    }).sort((a, b) => b.month.localeCompare(a.month))[0];
    if (!latest) return { key, label, window, evidence: [], providerReturnedCount: rows.length, status: "partial", error: null, coverageNote: "No valid, non-future monthly observation was returned." };
    const stale = now - Date.parse(`${latest.month}-01T00:00:00Z`) > 150 * 86_400_000;
    return { key, label, window, providerReturnedCount: rows.length, evidence: [officialItem({ id: `bls:${series.id}:${latest.month}`, title: `United States · ${series.name} · ${latest.month}`, url: `https://data.bls.gov/timeseries/${series.id}`,
      source: "U.S. Bureau of Labor Statistics", timeLabel: "Observation month", timeValue: latest.month,
      context: `${latest.value.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${series.unit}. Official U.S. aggregate, not a company or selected-country statistic; CPI level is not an inflation rate.`,
      attribution: "U.S. Bureau of Labor Statistics", attributionUrl: "https://www.bls.gov/developers/", sourceOperatorKey: "bls", sourceOperatorLabel: "U.S. Bureau of Labor Statistics" })],
      status: stale ? "partial" : "complete", error: null, coverageNote: `One exact U.S. monthly series; selected-country labor or prices are not inferred. ${stale ? "Observation is more than five months old. " : ""}The unregistered API can rate-limit searches.` };
  } catch { return unavailable(key, label, window); }
}

/** Fed headlines are primary policy releases, not numerical measures of the policy stance. */
export async function searchFedPolicy(fetcher: typeof fetch = fetch, now = Date.now()): Promise<OfficialDriverResult> {
  const key = "fed-policy", label = "Federal Reserve · monetary policy releases", window = "Latest two release headlines · past 90 days";
  try {
    const response = await fetcher("https://www.federalreserve.gov/feeds/press_monetary.xml", { headers: { accept: "application/rss+xml, application/xml" }, signal: AbortSignal.timeout(7000) });
    const xml = await boundedText(response);
    if (XMLValidator.validate(xml) !== true) throw new Error("Invalid RSS");
    const parsed = new XMLParser({ processEntities: false }).parse(xml) as { rss?: { channel?: { item?: unknown } } };
    const items = parsed.rss?.channel?.item;
    if (!items) throw new Error("No RSS items");
    const entries = (Array.isArray(items) ? items : [items]).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const link = typeof row.link === "string" ? row.link.trim() : "";
      const date = typeof row.pubDate === "string" ? Date.parse(row.pubDate) : NaN;
      let url: URL;
      try { url = new URL(link); } catch { return []; }
      if (!title || title.length > 250 || !Number.isFinite(date) || date > now || now - date > 90 * 86_400_000 ||
        url.protocol !== "https:" || url.hostname !== "www.federalreserve.gov" || !url.pathname.startsWith("/newsevents/pressreleases/monetary")) return [];
      return [{ title, link: url.toString(), date }];
    }).sort((a, b) => b.date - a.date).slice(0, 2);
    return { key, label, window, providerReturnedCount: (Array.isArray(items) ? items : [items]).length, status: entries.length ? "complete" : "partial", error: null,
      coverageNote: "Official U.S. policy-release headlines only. A headline does not state the current target rate or quantify its effect on an equity.",
      evidence: entries.map(({ title, link, date }) => officialItem({ id: `fed-policy:${new URL(link).pathname.split("/").pop()}`, title, url: link,
        source: "Federal Reserve Board", timeLabel: "Released", timeValue: new Date(date).toISOString(),
        context: "Monetary-policy release. Open the original statement or minutes before inferring a policy change; this headline is not an observed equity driver magnitude.",
        attribution: "Federal Reserve Board", attributionUrl: "https://www.federalreserve.gov/disclaimer.htm", sourceOperatorKey: "federal-reserve-board", sourceOperatorLabel: "Federal Reserve Board" }, "official policy release")) };
  } catch { return unavailable(key, label, window); }
}

/** The Selic target is a Brazilian policy rate, not a stock return or country opinion. */
export async function searchBcbSelic(fetcher: typeof fetch = fetch, now = Date.now()): Promise<OfficialDriverResult> {
  const key = "bcb-selic", label = "Banco Central do Brasil · Selic target", window = "Latest policy-rate target · past 45 days";
  try {
    const endpoint = new URL("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados");
    const start = new Date(now - 45 * 86_400_000);
    const format = (date: Date) => `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
    endpoint.searchParams.set("formato", "json"); endpoint.searchParams.set("dataInicial", format(start)); endpoint.searchParams.set("dataFinal", format(new Date(now)));
    const response = await fetcher(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    const body: unknown = JSON.parse(await boundedText(response));
    if (!Array.isArray(body)) throw new Error("Unexpected BCB payload");
    const latest = body.flatMap((record) => {
      if (!record || typeof record !== "object") return [];
      const row = record as Record<string, unknown>;
      const match = typeof row.data === "string" ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.data) : null;
      const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
      const date = Date.parse(`${iso}T00:00:00Z`);
      const value = typeof row.valor === "string" ? Number(row.valor.replace(",", ".")) : NaN;
      return match && Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === iso && date <= now && Number.isFinite(value) && value >= 0 && value <= 100
        ? [{ iso, value }] : [];
    }).sort((a, b) => b.iso.localeCompare(a.iso))[0];
    if (!latest) return { key, label, window, evidence: [], providerReturnedCount: body.length, status: "partial", error: null, coverageNote: "The bounded BCB series returned no valid, non-future observation." };
    return { key, label, window, providerReturnedCount: body.length, status: "complete", error: null, coverageNote: "Brazil's policy-rate target, not a borrowing rate for a particular company or evidence of a share-price move.",
      evidence: [officialItem({ id: `bcb-selic:432:${latest.iso}`, title: `Brazil · Selic target · ${latest.iso}`, url: "https://dadosabertos.bcb.gov.br/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom",
        source: "Banco Central do Brasil", timeLabel: "Observation date", timeValue: latest.iso,
        context: `${latest.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}% per year · Copom Selic target. The observation is a policy-rate level, not a causal equity-return estimate.`,
        attribution: "Banco Central do Brasil · SGS 432", attributionUrl: "https://dadosabertos.bcb.gov.br/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom",
        licenseName: "Open Data Commons ODbL", licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/", sourceOperatorKey: "bcb", sourceOperatorLabel: "Banco Central do Brasil" })] };
  } catch { return unavailable(key, label, window); }
}

export async function searchOfficialDrivers(topic: string, country: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<OfficialDriverResult[]> {
  const plan = officialDriverPlan(topic, country);
  return Promise.all(plan.map((key) => key === "eurostat-industrial" ? searchEurostatIndustrial(country, fetcher, now)
    : key === "bls-us" ? searchBls(topic, fetcher, now)
    : key === "fed-policy" ? searchFedPolicy(fetcher, now)
    : searchBcbSelic(fetcher, now)));
}
