import { describe, expect, it, vi } from "vitest";
import { searchWorldBankMacro, worldBankIndicatorForQuery } from "./world-bank-macro";

describe("World Bank macro context", () => {
  it.each([
    ["inflation in Korea", "FP.CPI.TOTL.ZG"],
    ["GDP growth", "NY.GDP.MKTP.KD.ZG"],
    ["unemployment rate", "SL.UEM.TOTL.ZS"],
    ["한국의 물가상승", "FP.CPI.TOTL.ZG"],
    ["日本の失業率", "SL.UEM.TOTL.ZS"],
  ])("maps explicit macro concepts only: %s", (query, code) => {
    expect(worldBankIndicatorForQuery(query)?.code).toBe(code);
  });

  it("does not query World Bank for unrelated or vaguely related markets", async () => {
    const fetcher = vi.fn();
    expect(worldBankIndicatorForQuery("semiconductor supply chain")).toBeNull();
    await expect(searchWorldBankMacro("semiconductor supply chain", "KR", fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps only requested U.S., selected-country and world observations with year and license provenance", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("api.worldbank.org");
      expect(url.pathname).toContain("USA;KOR;WLD");
      expect(url.pathname).toContain("FP.CPI.TOTL.ZG");
      expect(url.searchParams.get("mrnev")).toBe("3");
      expect(url.searchParams.get("date")).toContain(":");
      return Response.json([{}, [
        { country: { id: "US", value: "United States" }, countryiso3code: "USA", indicator: { id: "FP.CPI.TOTL.ZG" }, date: "2025", value: 2.9 },
        { country: { id: "KR", value: "Korea, Rep." }, countryiso3code: "KOR", indicator: { id: "FP.CPI.TOTL.ZG" }, date: "2024", value: 2.3 },
        { country: { id: "1W", value: "World" }, countryiso3code: "WLD", indicator: { id: "FP.CPI.TOTL.ZG" }, date: "2025", value: null },
        { country: { id: "CN", value: "China" }, countryiso3code: "CHN", indicator: { id: "FP.CPI.TOTL.ZG" }, date: "2025", value: 0.2 },
        { country: { id: "US", value: "United States" }, countryiso3code: "USA", indicator: { id: "OTHER" }, date: "2025", value: 1 },
        { country: { id: "US", value: "United States" }, countryiso3code: "USA", indicator: { id: "FP.CPI.TOTL.ZG" }, date: "2025", value: 9.9, obs_status: "F" },
      ]]);
    });

    const evidence = await searchWorldBankMacro("inflation", "KR", fetcher);
    expect(evidence).toHaveLength(2);
    expect(evidence.map(({ title }) => title)).toEqual([
      "United States · Inflation, consumer prices (annual %) · 2025",
      "Korea, Rep. · Inflation, consumer prices (annual %) · 2024",
    ]);
    expect(evidence[0]).toMatchObject({
      evidenceClass: "official statistical data",
      attribution: "World Bank, World Development Indicators · CC BY 4.0",
      licenseName: "Creative Commons Attribution 4.0 International",
    });
    expect(evidence[0].context).toContain("not a measure of online discussion");
    expect(evidence[0].url).toContain("/country/USA/indicator/FP.CPI.TOTL.ZG");
  });

  it("rejects invalid country lenses and provider failures", async () => {
    await expect(searchWorldBankMacro("inflation", "XX", vi.fn())).rejects.toThrow("supported country lenses");
    await expect(searchWorldBankMacro("inflation", "US", vi.fn(async () => new Response("", { status: 503 }))))
      .rejects.toThrow("HTTP 503");
    await expect(searchWorldBankMacro("inflation", "US", vi.fn(async () => Response.json({ error: "bad" }))))
      .rejects.toThrow("unexpected response");
  });
});
