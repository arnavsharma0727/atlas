import { XMLParser, XMLValidator } from "fast-xml-parser";
import { publicationDateFromISO } from "./publication-date";
import { withFetchTimeout } from "./fetch-with-timeout";
import type { ResearchEvidence } from "./research-brief";

export const ECB_FEED = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_REFERENCE = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";
export const ECB_TERMS = "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html";
const currencies: Record<string, string> = { US: "USD", KR: "KRW", JP: "JPY", DE: "EUR", FR: "EUR", BR: "BRL", IN: "INR", ES: "EUR" };
export function ecbCurrencies(country: string): string[] {
  if (!Object.hasOwn(currencies, country)) throw new Error("Choose a supported Atlas lens.");
  return [...new Set(["USD", currencies[country]])].filter((code) => code !== "EUR");
}
export type EcbReferenceSample = { evidence: ResearchEvidence[]; missingCurrencies: string[]; stale: boolean; observedDate: string; fetchedAt: string };

/** One official daily snapshot, never a live tradable quote or national opinion. */
export function parseEcbReference(xml: string, country: string, now = Date.now(), fetchedAt = new Date(now).toISOString()): EcbReferenceSample {
  const requested = ecbCurrencies(country);
  if (xml.length > 100_000 || /<!DOCTYPE|<!ENTITY/iu.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid ECB XML.");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false, removeNSPrefix: true });
  const daily = parser.parse(xml)?.Envelope?.Cube?.Cube;
  const date = publicationDateFromISO(daily?.["@_time"]);
  const today = Math.floor(now / 86400000) * 86400000;
  if (!date || date.timestamp > today || !daily.Cube || typeof daily.Cube !== "object") throw new Error("Invalid ECB observation date or rate collection.");
  const rows = Array.isArray(daily.Cube) ? daily.Cube : [daily.Cube];
  const values = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    const currency = row?.["@_currency"], rate = row?.["@_rate"];
    if (!requested.includes(currency)) continue;
    if (values.has(currency)) { duplicates.add(currency); continue; }
    if (typeof rate !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(rate) || !Number.isFinite(Number(rate)) || Number(rate) <= 0) continue;
    values.set(currency, rate);
  }
  for (const code of duplicates) values.delete(code);
  const stale = today - date.timestamp > 7 * 86400000;
  return {
    fetchedAt, observedDate: date.value, stale,
    missingCurrencies: requested.filter((code) => !values.has(code)),
    evidence: [...values].map(([code, rate]) => ({
      id: `ecb-reference:${code}:${date.value}`,
      title: `ECB euro reference rate · 1 EUR = ${rate} ${code} · ${date.value}`,
      url: ECB_REFERENCE, source: "European Central Bank · daily euro reference rates",
      evidenceClass: "official statistical data", language: "Not applicable · statistical series",
      timeLabel: "Reference observation date", timeValue: date.value, summaryEligible: false,
      attribution: "European Central Bank", attributionUrl: ECB_REFERENCE,
      licenseName: "ECB free-use conditions · attribution required", licenseUrl: ECB_TERMS,
      sourceOperatorKey: "ecb-statistics", sourceOperatorLabel: "European Central Bank",
      context: `Unmodified ECB reference value: units of ${code} per euro. Published on working days; holidays/weekends can delay updates.${stale ? " STALE: observation is more than seven calendar days old." : ""} Not a live spot quote, executable price, forecast, investor opinion or national viewpoint. No cross-rate or return is calculated. Germany, France and Spain share EUR; no separate national currency quote is invented. ECB discourages transaction use. Free original dataset is linked.`,
    })),
  };
}

export async function fetchEcbReference(fetcher: typeof fetch = fetch): Promise<{ xml: string; fetchedAt: string }> {
  const response = await withFetchTimeout(fetcher, 6000, 100_000)(ECB_FEED, { headers: { accept: "application/xml" }, cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("ECB reference feed is unavailable.");
  return { xml: await response.text(), fetchedAt: new Date().toISOString() };
}
