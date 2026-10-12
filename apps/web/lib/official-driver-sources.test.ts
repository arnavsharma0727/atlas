import { describe, expect, it, vi } from "vitest";
import { officialDriverPlan } from "./official-driver-plan";
import { searchBcbSelic, searchBls, searchEurostatIndustrial, searchFedPolicy, searchOfficialDrivers } from "./official-driver-sources";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("four keyless official driver sources", () => {
  it("plans only available geographies and explicit U.S. labor/price/policy queries", () => {
    expect(officialDriverPlan("semiconductor equipment", "DE")).toEqual(["eurostat-industrial"]);
    expect(officialDriverPlan("coffee shops", "DE")).toEqual([]);
    expect(officialDriverPlan("inflation and layoffs", "BR")).toEqual(["bls-us", "fed-policy", "bcb-selic"]);
    expect(officialDriverPlan("solar panels", "US")).toEqual([]);
  });

  it("reads exact Eurostat broad-industry dimensions and rejects future months", async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("indic_bt=PRD");
      expect(String(url)).toContain("nace_r2=B-D");
      return response({ id: ["freq", "indic_bt", "nace_r2", "s_adj", "unit", "geo", "time"], size: [1, 1, 1, 1, 1, 1, 2],
        value: { 0: 90.7, 1: 99.9 }, dimension: {
          freq: { category: { index: { M: 0 } } }, indic_bt: { category: { index: { PRD: 0 } } },
          nace_r2: { category: { index: { "B-D": 0 } } }, s_adj: { category: { index: { SCA: 0 } } },
          unit: { category: { index: { I21: 0 } } }, geo: { category: { index: { DE: 0 } } },
          time: { category: { index: { "2026-08": 0, "2026-11": 1 } } },
        } });
    });
    const result = await searchEurostatIndustrial("DE", fetcher as typeof fetch, NOW);
    expect(result).toMatchObject({ status: "complete", evidence: [{ id: "eurostat-industrial:DE:2026-08", summaryEligible: false }] });
    expect(result.evidence[0].context).toContain("90.7 index points");
  });

  it("keeps the monthly BLS series definition and never mistakes CPI level for inflation rate", async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("CUUR0000SA0");
      return response({ status: "REQUEST_SUCCEEDED", Results: { series: [{ seriesID: "CUUR0000SA0", data: [
        { year: "2026", period: "M11", value: "400" }, { year: "2026", period: "M09", value: "335.2" },
      ] }] } });
    });
    const result = await searchBls("inflation", fetcher as typeof fetch, NOW);
    expect(result.evidence.map((item) => item.id)).toEqual(["bls:CUUR0000SA0:2026-09"]);
    expect(result.evidence[0].context).toContain("CPI level is not an inflation rate");
  });

  it("keeps only recent, official Fed release links", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>FOMC minutes</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261007a.htm</link><pubDate>Wed, 7 Oct 2026 18:00:00 GMT</pubDate></item><item><title>Future statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261107a.htm</link><pubDate>Sat, 7 Nov 2026 18:00:00 GMT</pubDate></item><item><title>External</title><link>https://example.org/a</link><pubDate>Wed, 7 Oct 2026 18:00:00 GMT</pubDate></item></channel></rss>`;
    const result = await searchFedPolicy(vi.fn(async () => new Response(xml)) as typeof fetch, NOW);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].sourceOperatorKey).toBe("federal-reserve-board");
    expect(result.evidence[0].evidenceClass).toBe("official policy release");
    expect(result.evidence[0].summaryEligible).toBe(false);
  });

  it("bounds Brazil's Selic series to the chosen date and excludes future observations", async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("dataFinal=12%2F10%2F2026");
      return response([{ data: "13/10/2026", valor: "20.5" }, { data: "12/10/2026", valor: "13.75" }]);
    });
    const result = await searchBcbSelic(fetcher as typeof fetch, NOW);
    expect(result.evidence.map((item) => item.id)).toEqual(["bcb-selic:432:2026-10-12"]);
    expect(result.evidence[0].context).toContain("13.75% per year");
  });

  it("reports each failed official provider independently rather than inventing a zero", async () => {
    const results = await searchOfficialDrivers("industrial inflation", "DE", vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch, NOW);
    expect(results.map((item) => item.key)).toEqual(["eurostat-industrial", "bls-us", "fed-policy"]);
    expect(results.every((item) => item.status === "unavailable" && item.error && item.evidence.length === 0)).toBe(true);
  });
});
