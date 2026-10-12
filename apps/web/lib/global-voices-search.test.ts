import { describe, expect, it, vi } from "vitest";
import { GLOBAL_VOICES_SEARCH_EDITIONS, searchGlobalVoices } from "./global-voices-search";

const NOW = Date.parse("2026-10-08T12:00:00Z");

describe("searchGlobalVoices", () => {
  it("queries every fixed language edition and returns only recent, first-party headline metadata", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify([{
        id: 99,
        date_gmt: new Date(NOW - 60_000).toISOString().replace(/Z$/, ""),
        link: `https://${url.hostname}/story/example/`,
        title: { rendered: "Inflation: perspectives &amp; markets" },
        content: { rendered: "This content was not requested." },
      }]));
    });
    const editions = await searchGlobalVoices("inflation", fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(GLOBAL_VOICES_SEARCH_EDITIONS.length);
    expect(editions).toHaveLength(14);
    expect(editions).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: "ja", edition: "Japanese", error: null }),
      expect.objectContaining({ language: "bn", edition: "Bengali", error: null }),
    ]));
    expect(editions[1]).toMatchObject({
      language: "es",
      edition: "Spanish",
      articles: [{
        id: "es:99",
        title: "Inflation: perspectives & markets",
        url: "https://es.globalvoices.org/story/example/",
        publishedAt: new Date(NOW - 60_000).toISOString(),
      }],
      error: null,
    });
    const request = new URL(String(fetcher.mock.calls[0][0]));
    expect(request.pathname).toBe("/wp-json/wp/v2/posts");
    expect(request.searchParams.get("_fields")).toBe("id,date_gmt,link,title");
    expect(JSON.stringify(editions)).not.toContain("This content was not requested");
  });

  it("isolates a failed edition and filters stale, off-host, and body-only matches", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "es.globalvoices.org") return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify([
        { id: 1, date_gmt: "2026-01-01T00:00:00", link: `https://${url.hostname}/old/`, title: { rendered: "Old" } },
        { id: 2, date_gmt: new Date(NOW - 60_000).toISOString(), link: "https://attacker.example/story/", title: { rendered: "Off host" } },
        { id: 3, date_gmt: new Date(NOW - 60_000).toISOString(), link: `https://${url.hostname}/body-only/`, title: { rendered: "A story with unrelated headline" }, content: { rendered: "Inflation is mentioned only in the article body" } },
      ]));
    });
    const editions = await searchGlobalVoices("inflation", fetcher, NOW);
    expect(editions[1]).toMatchObject({ error: "Rate limited", articles: [] });
    expect(editions.filter(({ error }) => !error).flatMap(({ articles }) => articles)).toEqual([]);
  });

  it("filters loose two-letter ticker matches against the visible headline", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify([
        { id: 1, date_gmt: new Date(NOW - 60_000).toISOString(), link: `https://${url.hostname}/ev-exact/`, title: { rendered: "EV battery investment" } },
        { id: 2, date_gmt: new Date(NOW - 60_000).toISOString(), link: `https://${url.hostname}/unrelated/`, title: { rendered: "El Niño and food security" } },
      ]));
    });
    const editions = await searchGlobalVoices("EV", fetcher, NOW);
    expect(editions.flatMap(({ articles }) => articles.map(({ id }) => id))).toEqual(GLOBAL_VOICES_SEARCH_EDITIONS.map(({ language }) => `${language}:1`));
  });

  it("rejects invalid phrases before contacting any edition", async () => {
    const fetcher = vi.fn();
    await expect(searchGlobalVoices("x", fetcher, NOW)).rejects.toThrow("2–100");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
