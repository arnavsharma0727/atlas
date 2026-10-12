import { describe, expect, it, vi } from "vitest";
import { searchSecEdgarFilings } from "./sec-edgar-research-search";

const NOW = Date.parse("2026-10-11T00:00:00Z");
const USER_AGENT = "Atlas Research (atlas-test@example.test)";

function companyIndex() {
  return new Response(JSON.stringify({
    0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    1: { cik_str: 1318605, ticker: "TSLA", title: "Tesla, Inc." },
    2: { cik_str: "bad", ticker: "BAD", title: "Malformed issuer" },
  }), { status: 200 });
}

function submissions() {
  return new Response(JSON.stringify({
    name: "Apple Inc.",
    filings: { recent: {
      form: ["10-Q", "8-K", "S-1", "10-K", "6-K"],
      accessionNumber: ["0000320193-26-000001", "0000320193-26-000002", "0000320193-26-000003", "0000320193-20-000004", "invalid"],
      filingDate: ["2026-08-01", "2026-09-02", "2026-09-05", "2020-09-01", "2026-09-05"],
      primaryDocument: ["aapl-20260630.htm", "aapl-20260902.htm", "bad.htm", "old.htm", "bad path.htm"],
      primaryDocDescription: ["Quarterly report", "Current report", "Registration", "Old filing", "Unsafe path"],
    } },
  }), { status: 200 });
}

describe("SEC EDGAR issuer filing metadata search", () => {
  it("accepts an exact company name, requests only official metadata, and returns recent valid filings", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(companyIndex())
      .mockResolvedValueOnce(submissions());
    const result = await searchSecEdgarFilings("Apple Inc.", USER_AGENT, fetcher as typeof fetch, NOW);
    expect(result.issuer).toEqual({ cik: "0000320193", ticker: "AAPL", name: "Apple Inc." });
    expect(result.filings).toHaveLength(2);
    expect(result.filings.map(({ form }) => form)).toEqual(["8-K", "10-Q"]);
    expect(result.filings[0].url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000002/aapl-20260902.htm");
    const [indexUrl, indexInit] = fetcher.mock.calls[0];
    const [submissionsUrl, submissionsInit] = fetcher.mock.calls[1];
    expect(String(indexUrl)).toBe("https://www.sec.gov/files/company_tickers.json");
    expect(String(submissionsUrl)).toBe("https://data.sec.gov/submissions/CIK0000320193.json");
    expect(new Headers(indexInit?.headers).get("user-agent")).toBe(USER_AGENT);
    expect(new Headers(submissionsInit?.headers).get("user-agent")).toBe(USER_AGENT);
    expect(indexInit).toMatchObject({ cache: "force-cache", next: { revalidate: 86_400 } });
  });

  it("accepts an exact ticker but does not broaden a topic phrase into an issuer guess", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(companyIndex()).mockResolvedValueOnce(submissions());
    expect((await searchSecEdgarFilings("AAPL", USER_AGENT, fetcher as typeof fetch, NOW)).issuer?.ticker).toBe("AAPL");
    const noMatchFetcher = vi.fn().mockResolvedValueOnce(companyIndex());
    expect(await searchSecEdgarFilings("semiconductor demand", USER_AGENT, noMatchFetcher as typeof fetch, NOW)).toEqual({ issuer: null, filings: [] });
    expect(noMatchFetcher).toHaveBeenCalledOnce();
  });

  it("rejects missing contact identity, invalid input, malformed JSON, and oversized responses", async () => {
    const fetcher = vi.fn();
    await expect(searchSecEdgarFilings("Apple", "Atlas", fetcher as typeof fetch, NOW)).rejects.toThrow("contact email");
    await expect(searchSecEdgarFilings("A", USER_AGENT, fetcher as typeof fetch, NOW)).rejects.toThrow("2–100");
    expect(fetcher).not.toHaveBeenCalled();
    const invalid = vi.fn().mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(searchSecEdgarFilings("Apple", USER_AGENT, invalid as typeof fetch, NOW)).rejects.toThrow("invalid JSON");
    const oversized = vi.fn().mockResolvedValueOnce(new Response("x".repeat(4_000_001), { status: 200 }));
    await expect(searchSecEdgarFilings("Apple", USER_AGENT, oversized as typeof fetch, NOW)).rejects.toThrow("oversized");
  });

  it("validates the query-hosted issuer index and filing URLs before returning citations", async () => {
    const unsafeIndex = new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }), { status: 200 });
    const unsafeSubmissions = new Response(JSON.stringify({ name: "Apple Inc.", filings: { recent: {
      form: ["10-Q", "10-Q"],
      accessionNumber: ["../../etc/passwd", "0000320193-26-000001"],
      filingDate: ["2026-08-01", "2026-08-01"],
      primaryDocument: ["safe.htm", "../../bad"],
    } } }), { status: 200 });
    const fetcher = vi.fn().mockResolvedValueOnce(unsafeIndex).mockResolvedValueOnce(unsafeSubmissions);
    const result = await searchSecEdgarFilings("AAPL", USER_AGENT, fetcher as typeof fetch, NOW);
    expect(result.filings).toEqual([]);
  });

  it("returns no filing records rather than treating stale or malformed dates as current", async () => {
    const index = new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }), { status: 200 });
    const old = new Response(JSON.stringify({ name: "Apple Inc.", filings: { recent: {
      form: ["10-K", "10-Q"], accessionNumber: ["0000320193-20-000001", "0000320193-26-000002"],
      filingDate: ["2020-09-01", "not-a-date"], primaryDocument: ["old.htm", "bad.htm"],
    } } }), { status: 200 });
    const fetcher = vi.fn().mockResolvedValueOnce(index).mockResolvedValueOnce(old);
    expect((await searchSecEdgarFilings("AAPL", USER_AGENT, fetcher as typeof fetch, NOW)).filings).toEqual([]);
  });
});
