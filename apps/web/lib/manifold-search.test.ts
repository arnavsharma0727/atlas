import { describe, expect, it, vi } from "vitest";
import { searchManifoldForecasts } from "./manifold-search";

describe("Manifold public forecast search", () => {
  const now = Date.parse("2026-10-11T08:00:00Z");
  const market = (override: Record<string, unknown> = {}) => ({
    id: "m-1",
    question: "Will Bitcoin exceed $100,000 by year end?",
    url: "https://manifold.markets/forecaster/bitcoin-over-100k",
    probability: 0.61,
    volume24Hours: 123,
    totalLiquidity: 800,
    closeTime: now + 86400000,
    lastUpdatedTime: now - 1000,
    isResolved: false,
    outcomeType: "BINARY",
    token: "MANA",
    ...override,
  });

  it("requests active binary MANA markets and returns current forecast metadata", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://api.manifold.markets/v0/search-markets");
      expect(url.searchParams.get("term")).toBe("bitcoin");
      expect(url.searchParams.get("sort")).toBe("24-hour-vol");
      expect(url.searchParams.get("filter")).toBe("open");
      expect(url.searchParams.get("contractType")).toBe("BINARY");
      expect(url.searchParams.get("limit")).toBe("20");
      return Response.json([market()]);
    });

    const results = await searchManifoldForecasts("bitcoin", fetcher as typeof fetch, now);

    expect(results).toEqual([{
      id: "m-1",
      question: "Will Bitcoin exceed $100,000 by year end?",
      url: "https://manifold.markets/forecaster/bitcoin-over-100k",
      probability: 0.61,
      volume24Hours: 123,
      liquidity: 800,
      closesAt: new Date(now + 86400000).toISOString(),
      updatedAt: new Date(now - 1000).toISOString(),
    }]);
  });

  it("excludes cash, non-binary, resolved, inactive, unliquid, stale, and unrelated markets", async () => {
    const fetcher = vi.fn(async () => Response.json([
      market({ id: "cash", token: "CASH" }),
      market({ id: "multi", outcomeType: "MULTIPLE_CHOICE" }),
      market({ id: "resolved", isResolved: true }),
      market({ id: "no-volume", volume24Hours: 0 }),
      market({ id: "bad-liquidity", totalLiquidity: 0 }),
      market({ id: "expired", closeTime: now - 1 }),
      market({ id: "irrelevant", question: "Will Ethereum exceed $100,000 by year end?" }),
      market({ id: "unsafe", url: "https://example.com/market" }),
      market({ id: "valid" }),
    ]));

    const results = await searchManifoldForecasts("bitcoin", fetcher as typeof fetch, now);

    expect(results.map(({ id }) => id)).toEqual(["valid"]);
  });

  it("honors exact quoted phrases and rejects provider failures", async () => {
    const fetcher = vi.fn(async () => Response.json([
      market({ id: "phrase", question: "Will bitcoin exceed $100k?" }),
      market({ id: "apart", question: "Bitcoin predictions: will it exceed $100k?" }),
    ]));
    expect((await searchManifoldForecasts('"bitcoin exceed"', fetcher as typeof fetch, now)).map(({ id }) => id)).toEqual(["phrase"]);
    const limited = vi.fn(async () => new Response(null, { status: 429 }));
    await expect(searchManifoldForecasts("bitcoin", limited as typeof fetch, now)).rejects.toThrow("rate-limiting");
    const invalid = vi.fn();
    await expect(searchManifoldForecasts("the of", invalid as typeof fetch, now)).resolves.toEqual([]);
    expect(invalid).not.toHaveBeenCalled();
  });
});
