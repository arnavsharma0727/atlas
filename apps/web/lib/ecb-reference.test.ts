import { describe, expect, it, vi } from "vitest";
import { ecbCurrencies, fetchEcbReference, parseEcbReference } from "./ecb-reference";
import { selectBalancedEvidence } from "./market-summary";

const NOW = Date.UTC(2026, 9, 12);
const xml = (date = "2026-10-09", rows = '<Cube currency="USD" rate="1.1234"/><Cube currency="KRW" rate="1500.20"/>') =>
  `<gesmes:Envelope xmlns:gesmes="urn:test"><Cube><Cube time="${date}">${rows}</Cube></Cube></gesmes:Envelope>`;
describe("ECB official daily context", () => {
  it("preserves rates, reference date, attribution, units and no-AI status", () => {
    const sample = parseEcbReference(xml(), "KR", NOW);
    expect(sample.missingCurrencies).toEqual([]);
    expect(sample.stale).toBe(false);
    expect(sample.evidence).toHaveLength(2);
    expect(sample.evidence[1].title).toContain("1 EUR = 1500.20 KRW");
    expect(sample.evidence[0]).toMatchObject({ timeValue: "2026-10-09", summaryEligible: false, sourceOperatorKey: "ecb-statistics" });
    expect(selectBalancedEvidence([{ key: "ecb-reference", query: "currency", label: "ECB", asOf: new Date(NOW).toISOString(), window: "Daily", status: "complete", error: null, evidence: sample.evidence }], new Map())).toEqual([]);
  });
  it("does not invent separate euro rates for euro-area lenses", () => {
    for (const country of ["US", "DE", "FR", "ES"]) expect(ecbCurrencies(country)).toEqual(["USD"]);
    expect(() => ecbCurrencies("__proto__")).toThrow();
  });
  it("distinguishes stale snapshots and missing currencies", () => {
    const sample = parseEcbReference(xml("2026-09-01"), "JP", NOW);
    expect(sample.stale).toBe(true);
    expect(sample.missingCurrencies).toEqual(["JPY"]);
    expect(sample.evidence[0].context).toContain("STALE");
  });
  it.each(["2026-02-29", "2026-10-13", "undated"])("rejects impossible/future/missing dates: %s", (date) => {
    expect(() => parseEcbReference(xml(date), "KR", NOW)).toThrow();
  });
  it.each(["0", "-1", "NaN", "Infinity", "1e4", "1,200"])("does not display invalid reference rate %s", (rate) => {
    expect(parseEcbReference(xml(undefined, `<Cube currency="USD" rate="${rate}"/>`), "US", NOW).missingCurrencies).toEqual(["USD"]);
  });
  it("withholds duplicate conflicting currencies and rejects entity declarations", () => {
    expect(parseEcbReference(xml(undefined, '<Cube currency="USD" rate="1.1"/><Cube currency="USD" rate="1.2"/>'), "US", NOW).missingCurrencies).toEqual(["USD"]);
    expect(() => parseEcbReference('<!DOCTYPE foo>'+xml(), "US", NOW)).toThrow();
  });
  it("uses one fixed public URL without topic text and fails closed on HTTP errors", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response("", { status: 429 }));
    await expect(fetchEcbReference(fetcher)).rejects.toThrow();
    expect(String(fetcher.mock.calls[0][0])).toBe("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
  });
});
