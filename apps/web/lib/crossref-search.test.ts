import { describe, expect, it, vi } from "vitest";
import { searchCrossrefWorks } from "./crossref-search";

const NOW = Date.parse("2026-10-11T00:00:00Z");

function item(overrides: Record<string, unknown> = {}) {
  return {
    DOI: "10.1234/example.1",
    title: ["Semiconductor investment and supply chains"],
    publisher: "Example Publisher",
    "container-title": ["Journal of Markets"],
    published: { "date-parts": [[2026, 4, 2]] },
    ...overrides,
  };
}

describe("Crossref public research metadata search", () => {
  it("preserves year/month/day precision and rejects rollover or coercible dates", async () => {
    const parts = [[2026], [2026, 2], [2024, 2, 29], [2026, 4, 31], [2026, 13], [2026, 2, 29], [2026, null], ["2026"]];
    const fetcher = vi.fn(async () => Response.json({ message: { items: parts.map((value, index) => item({ DOI: `10.1234/date.${index}`, published: { "date-parts": [value] } })) } }));
    const records = await searchCrossrefWorks("semiconductor", fetcher, NOW);
    expect(records.map((record) => record.publicationDate)).toEqual(["2026", "2026-02", "2024-02-29"]);
    expect(records[0].publishedAt).toBe("2026-01-01T00:00:00.000Z");
  });
  it("uses journal/title economic context but excludes physical and unresolved inflation", async () => {
    const fetcher = vi.fn(async () => Response.json({ message: { items: [
      item({ title: ["Inflation"], "container-title": ["Journal of Monetary Economics"] }),
      item({ title: ["Inflation and consumer prices"], "container-title": [] }),
      item({ title: ["Cosmological inflation"], "container-title": ["Economics"] }),
      item({ title: ["Inflation"], "container-title": [], abstract: "consumer prices" }),
    ] } }));
    expect((await searchCrossrefWorks("inflation", fetcher, NOW)).map((record) => record.title)).toEqual(["Inflation", "Inflation and consumer prices"]);
  });
  it("requests a small, recent title-only bibliographic result set and keeps DOI links", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ message: { items: [item()] } }), { status: 200 }));
    const results = await searchCrossrefWorks("semiconductor investment", fetcher as typeof fetch, NOW);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      doi: "10.1234/example.1",
      url: "https://doi.org/10.1234/example.1",
      publisher: "Example Publisher",
      language: "Not reported",
    });
    const [requestUrl, init] = fetcher.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.hostname).toBe("api.crossref.org");
    expect(url.searchParams.get("rows")).toBe("25");
    expect(url.searchParams.get("select")).not.toContain("abstract");
    expect(url.searchParams.get("select")).not.toContain("language");
    expect(url.searchParams.get("filter")).toContain("from-pub-date:2021-10-11");
    expect(init?.cache).toBe("no-store");
  });

  it("rejects irrelevant, future, stale, and malformed DOI metadata", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: { items: [
      item({ DOI: "not-a-doi" }),
      item({ title: ["A different research topic"] }),
      item({ published: { "date-parts": [[2027, 1, 1]] } }),
      item({ published: { "date-parts": [[2020, 1, 1]] } }),
    ] } }), { status: 200 }));
    expect(await searchCrossrefWorks("semiconductor investment", fetcher as typeof fetch, NOW)).toEqual([]);
  });

  it("bounds request terms, response size, and provider errors", async () => {
    await expect(searchCrossrefWorks("x", vi.fn() as typeof fetch, NOW)).rejects.toThrow("2–100");
    const oversized = vi.fn(async () => new Response(" ".repeat(1_000_001), { status: 200 }));
    await expect(searchCrossrefWorks("semiconductor", oversized as typeof fetch, NOW)).rejects.toThrow("oversized");
    const limited = vi.fn(async () => new Response("", { status: 429 }));
    await expect(searchCrossrefWorks("semiconductor", limited as typeof fetch, NOW)).rejects.toThrow("rate-limited");
  });
});
