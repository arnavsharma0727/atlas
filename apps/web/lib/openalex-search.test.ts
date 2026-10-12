import { describe, expect, it, vi } from "vitest";
import { searchOpenAlexWorks } from "./openalex-search";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const work = (title: string, offsetDays = 1) => ({
  id: "https://openalex.org/W12345",
  doi: "https://doi.org/10.1234/example.1",
  title,
  publication_date: new Date(NOW - offsetDays * 86_400_000).toISOString().slice(0, 10),
  type: "article",
  open_access: { is_oa: true },
  abstract_inverted_index: { private: [0] },
  authorships: [{ author: { display_name: "Private Author" } }],
});

describe("searchOpenAlexWorks", () => {
  it("requires economic title context for ambiguous inflation without using hidden fields", async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [
      work("Inflation and monetary policy"),
      work("Cosmological inflation"),
      { ...work("Inflation"), abstract_inverted_index: { economic: [0] } },
    ] }));
    expect((await searchOpenAlexWorks("inflation", fetcher, NOW)).map((record) => record.title)).toEqual(["Inflation and monetary policy"]);
    expect((await searchOpenAlexWorks("cosmological inflation", fetcher, NOW)).map((record) => record.title)).toEqual(["Cosmological inflation"]);
  });
  it("requests only selected title-level fields and returns recent complete title matches", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.openalex.org");
      expect(url.pathname).toBe("/works");
      expect(url.searchParams.get("select")).toBe("id,doi,title,publication_date,type,open_access");
      expect(init?.cache).toBe("no-store");
      expect(init?.headers).toMatchObject({ "user-agent": expect.stringContaining("Atlas/1.0") });
      return Response.json({ results: [work("Bitcoin market attention"), work("Market attention for bitcoin"), work("Bitcoin market"), work("Bitcoin and market attention", 1900)] });
    });
    const results = await searchOpenAlexWorks("bitcoin market", fetcher, NOW);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ title: "Bitcoin market attention", url: "https://doi.org/10.1234/example.1", workType: "article", openAccess: true });
    expect(JSON.stringify(results)).not.toContain("Private Author");
    expect(JSON.stringify(results)).not.toContain("abstract_inverted_index");
  });

  it("rejects non-OpenAlex or unsafe DOI URLs and malformed records", async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [
      { ...work("Bitcoin market attention"), id: "https://evil.example/W123", doi: "javascript:alert(1)" },
      { ...work("Bitcoin market attention"), id: "https://evil.example/W123", doi: "" },
      { ...work("Bitcoin market attention"), publication_date: "not-a-date" },
    ] }));
    expect(await searchOpenAlexWorks("bitcoin market", fetcher, NOW)).toEqual([]);
  });

  it("retries a transient OpenAlex 503 once, then returns the validated records", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ results: [work("Bitcoin market attention")] }));
    await expect(searchOpenAlexWorks("bitcoin market", fetcher, NOW)).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes provider errors and enforces query bounds before fetching", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 429 }));
    await expect(searchOpenAlexWorks("bitcoin", fetcher, NOW)).rejects.toThrow("keyless usage limit");
    await expect(searchOpenAlexWorks("x", fetcher, NOW)).rejects.toThrow("2–100");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
