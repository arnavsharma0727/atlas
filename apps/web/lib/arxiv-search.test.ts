import { describe, expect, it, vi } from "vitest";
import { searchArxiv } from "./arxiv-search";

const NOW = Date.parse("2026-10-11T00:00:00Z");

function feed(entries: string[]) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">${entries.join("")}</feed>`;
}

function entry({ id = "2604.01234", title = "Semiconductor investment and chip supply", published = "2026-04-02T00:00:00Z", category = "econ.GN", summary = "Private abstract should not be returned." } = {}) {
  return `<entry><id>http://arxiv.org/abs/${id}</id><title>${title}</title><published>${published}</published><arxiv:primary_category term="${category}"/><summary>${summary}</summary></entry>`;
}

describe("public arXiv metadata search", () => {
  it("preserves Hindi words in both the upstream query and retained title screen", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).searchParams.get("search_query")).toBe("all:कीमत AND all:नीति");
      return new Response(feed([entry({ title: "कीमत नीति" }), entry({ title: "मत नीति" })]));
    });
    expect((await searchArxiv("कीमत नीति", fetcher, NOW)).map((record) => record.title)).toEqual(["कीमत नीति"]);
  });
  it("rejects impossible submission dates and normalized 24-hour rollover", async () => {
    const fetcher = vi.fn(async () => new Response(feed([
      entry({ published: "2026-02-29T00:00:00Z" }),
      entry({ published: "2026-04-31T00:00:00Z" }),
      entry({ published: "2026-04-30T24:00:00Z" }),
      entry({ published: "2024-02-29T00:00:00Z" }),
    ])));
    expect((await searchArxiv("semiconductor", fetcher, NOW)).map((record) => record.publishedAt)).toEqual(["2024-02-29T00:00:00.000Z"]);
  });
  it("screens inflation using retained metadata, not discarded abstracts", async () => {
    const fetcher = vi.fn(async () => new Response(feed([
      entry({ title: "Inflation expectations", category: "econ.GN" }),
      entry({ title: "Cosmological inflation", category: "astro-ph.CO" }),
      entry({ title: "Quantum inflation: a Python library", category: "quant-ph" }),
      entry({ title: "Inflation", category: "", summary: "Consumer prices and monetary economics" }),
    ])));
    expect((await searchArxiv("inflation", fetcher, NOW)).map((record) => record.title)).toEqual(["Inflation expectations"]);
    expect((await searchArxiv("cosmological inflation", fetcher, NOW)).map((record) => record.title)).toEqual(["Cosmological inflation"]);
  });
  it("queries a bounded title/abstract search and returns only matched titles and links", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => new Response(feed([entry()]), { status: 200 }));
    const records = await searchArxiv("semiconductor investment", fetcher as typeof fetch, NOW);
    expect(records).toEqual([{
      id: "2604.01234", title: "Semiconductor investment and chip supply", url: "https://arxiv.org/abs/2604.01234",
      publishedAt: "2026-04-02T00:00:00.000Z", category: "econ.GN",
    }]);
    expect(JSON.stringify(records)).not.toContain("Private abstract");
    const [request] = fetcher.mock.calls[0];
    const url = new URL(String(request));
    expect(url.hostname).toBe("export.arxiv.org");
    expect(url.searchParams.get("search_query")).toBe("all:semiconductor AND all:investment");
    expect(url.searchParams.get("max_results")).toBe("30");
  });

  it("filters stale, future, irrelevant, malformed, and non-arXiv records", async () => {
    const fetcher = vi.fn(async () => new Response(feed([
      entry({ id: "bad/path" }),
      entry({ id: "2604.01235", title: "Different research subject" }),
      entry({ id: "2604.01236", published: "2027-01-01T00:00:00Z" }),
      entry({ id: "2604.01237", published: "2020-01-01T00:00:00Z" }),
    ]), { status: 200 }));
    expect(await searchArxiv("semiconductor investment", fetcher as typeof fetch, NOW)).toEqual([]);
  });

  it("bounds input and response size, and rejects DTD/entity payloads", async () => {
    await expect(searchArxiv("x", vi.fn() as typeof fetch, NOW)).rejects.toThrow("2–100");
    await expect(searchArxiv("semiconductor", vi.fn(async () => new Response(" ".repeat(1_000_001))) as typeof fetch, NOW)).rejects.toThrow("oversized");
    await expect(searchArxiv("semiconductor", vi.fn(async () => new Response("<!DOCTYPE feed [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><feed/>")) as typeof fetch, NOW)).rejects.toThrow("unexpected XML");
  });
});
