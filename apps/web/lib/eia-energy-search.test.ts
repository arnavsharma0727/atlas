import { describe, expect, it, vi } from "vitest";
import { eiaSeriesForQuery, searchEiaEnergyPrices } from "./eia-energy-search";

describe("EIA energy context", () => {
  it.each([
    ["WTI crude oil prices", ["RWTC", "RBRTE"]],
    ["Brent crude", ["RWTC", "RBRTE"]],
    ["natural gas Henry Hub", ["RNGWHHD"]],
    ["energy prices", ["RWTC", "RBRTE", "RNGWHHD"]],
    ["원유 가격", ["RWTC", "RBRTE"]],
  ])("maps narrow energy topics only: %s", (query, ids) => {
    expect(eiaSeriesForQuery(query).map(({ id }) => id)).toEqual(ids);
  });

  it("does not make upstream calls for unrelated topics", async () => {
    const fetcher = vi.fn();
    expect(eiaSeriesForQuery("semiconductor demand")).toEqual([]);
    await expect(searchEiaEnergyPrices("semiconductor demand", "key", fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(eiaSeriesForQuery("olive oil prices")).toEqual([]);
  });

  it("requests bounded official series and returns only valid dated U.S. benchmark records", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("api.eia.gov");
      expect(url.pathname).toContain("/petroleum/pri/spt/data/");
      expect(url.searchParams.get("facets[series][]")).toBe("RWTC");
      expect(url.searchParams.get("length")).toBe("5");
      expect(url.searchParams.get("api_key")).toBe("private-test-key");
      return Response.json({ response: { data: [
        { period: "2026-09-22", value: "96.41", series: "RWTC", "value-units": "$/BBL" },
        { period: "2026-09-21", value: "96.97", series: "RWTC", "value-units": "$/BBL" },
        { period: "2099-01-01", value: "1.00", series: "RWTC", "value-units": "$/BBL" },
        { period: "2026-09-22", value: "4.00", series: "UNREQUESTED", "value-units": "$/BBL" },
        { period: "2026-09-22", value: "NaN", series: "RWTC", "value-units": "$/BBL" },
      ] } });
    });
    const evidence = await searchEiaEnergyPrices("WTI crude oil", "private-test-key", fetcher, Date.parse("2026-09-30T12:00:00Z"));
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      id: "eia:RWTC:2026-09-22",
      evidenceClass: "official statistical data",
      attribution: "U.S. Energy Information Administration (EIA) · public-domain U.S. government data",
      licenseName: "U.S. government public-domain data",
    });
    expect(evidence[0].context).toContain("not a price for the selected country");
    expect(evidence[0].url).toContain("www.eia.gov/opendata/browser");
  });

  it("requires an operator key and handles provider failures without leaking it", async () => {
    const fetcher = vi.fn();
    await expect(searchEiaEnergyPrices("crude oil", "", fetcher)).rejects.toThrow("EIA_API_KEY");
    await expect(searchEiaEnergyPrices("crude oil", "private-test-key", vi.fn(async () => new Response("", { status: 429 }))))
      .rejects.toThrow("EIA rate limit");
    await expect(searchEiaEnergyPrices("crude oil", "private-test-key", vi.fn(async () => Response.json({ error: "invalid" }))))
      .rejects.toThrow("unexpected response");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
