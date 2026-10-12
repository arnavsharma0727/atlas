import { describe, expect, it, vi } from "vitest";
import { bisEerAppliesToQuery, searchBisEffectiveExchangeRates } from "./bis-effective-exchange";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");

function csv(area: string) {
  return [
    "FREQ,EER_TYPE,EER_BASKET,REF_AREA,UNIT_MEASURE,TIME_FORMAT,COLLECTION,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK",
    "M,N,B," + area + ",882,,A,Country - Nominal - Broad,2025-08,100,A,F,",
    "M,N,B," + area + ",882,,A,Country - Nominal - Broad,2026-08,105,A,F,",
    "M,R,B," + area + ",882,,A,Country - Real - Broad,2025-08,100,A,F,",
    "M,R,B," + area + ",882,,A,Country - Real - Broad,2026-08,102,A,F,",
  ].join("\n");
}

describe("BIS effective-exchange-rate context", () => {
  it("only activates on explicit currency or FX query language", () => {
    expect(bisEerAppliesToQuery("KRW currency outlook")).toBe(true);
    expect(bisEerAppliesToQuery("환율 and exports")).toBe(true);
    expect(bisEerAppliesToQuery("semiconductor demand")).toBe(false);
    expect(bisEerAppliesToQuery("company")).toBe(false);
  });

  it("returns attributed US and selected-country broad indices with separate nominal and real changes", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const area = url.pathname.endsWith(".US/all") ? "US" : "KR";
      expect(url.pathname).toContain("/api/v1/data/WS_EER/M..B.");
      expect(url.searchParams.get("format")).toBe("csvfile");
      expect(url.searchParams.get("startPeriod")).toBe("2023-01");
      return new Response(csv(area), { status: 200, headers: { "content-type": "text/csv" } });
    }) as unknown as typeof fetch;

    const result = await searchBisEffectiveExchangeRates("KRW currency", "KR", fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.missingSeries).toEqual([]);
    expect(result.staleSeries).toEqual([]);
    expect(result.evidence).toHaveLength(4);
    expect(result.evidence.map(({ id }) => id)).toEqual([
      "bis-eer:US:N:2026-08", "bis-eer:US:R:2026-08",
      "bis-eer:KR:N:2026-08", "bis-eer:KR:R:2026-08",
    ]);
    expect(result.evidence[0]).toMatchObject({
      evidenceClass: "official statistical data",
      sourceOperatorKey: "bis-statistics",
      licenseUrl: "https://data.bis.org/help/legal",
      timeLabel: "Latest monthly observation",
    });
    expect(result.evidence[0].context).toContain("Twelve-month index change: 5%");
    expect(result.evidence[0].context).toContain("appreciation in nominal terms");
    expect(result.evidence[0].context).toContain("not a bilateral spot exchange rate");
    expect(result.evidence[0].context).toContain("should not be compared directly");
  });

  it("deduplicates US/US lenses and returns no upstream calls for a non-FX topic", async () => {
    const fetcher = vi.fn(async () => new Response(csv("US"), { status: 200 })) as unknown as typeof fetch;
    const irrelevant = await searchBisEffectiveExchangeRates("semiconductor demand", "KR", fetcher, NOW);
    expect(irrelevant).toEqual({ evidence: [], missingSeries: [], staleSeries: [], failedAreas: [] });
    expect(fetcher).not.toHaveBeenCalled();

    await searchBisEffectiveExchangeRates("USD currency", "US", fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports missing series rather than inventing values and rejects malformed observations", async () => {
    const fetcher = vi.fn(async () => new Response(
      "FREQ,EER_TYPE,EER_BASKET,REF_AREA,UNIT_MEASURE,TIME_FORMAT,COLLECTION,TITLE_TS,TIME_PERIOD,OBS_VALUE\nM,N,B,US,882,,A,United States,2026-06,not-a-number",
      { status: 200 },
    )) as unknown as typeof fetch;
    const result = await searchBisEffectiveExchangeRates("exchange rate", "US", fetcher, NOW);
    expect(result.evidence).toEqual([]);
    expect(result.missingSeries).toEqual(["US:N", "US:R"]);
  });

  it("does not mislabel an upstream API error payload as an empty dataset", async () => {
    const fetcher = vi.fn(async () => new Response("<message:Error>temporary failure</message:Error>", { status: 200 })) as unknown as typeof fetch;
    const result = await searchBisEffectiveExchangeRates("FX", "US", fetcher, NOW);
    expect(result.failedAreas).toEqual(["US"]);
    expect(result.missingSeries).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it("retains the responding country when the other country's public endpoint fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(".KR/all")) return new Response("", { status: 503 });
      return new Response(csv("US"), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await searchBisEffectiveExchangeRates("USD currency", "KR", fetcher, NOW);
    expect(result.evidence).toHaveLength(2);
    expect(result.failedAreas).toEqual(["KR"]);
    expect(result.missingSeries).toEqual([]);
  });

  it("rejects a selected country outside Atlas's supported lenses", async () => {
    await expect(searchBisEffectiveExchangeRates("FX", "ZZ", vi.fn() as unknown as typeof fetch, NOW))
      .rejects.toThrow("supported country search lenses");
  });
});
