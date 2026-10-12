import { describe, expect, it } from "vitest";
import { selectedCountryContext } from "./country-context";
import type { ResearchSweepSourceResult } from "./research-sweep";

const official = (id: string, title: string, context: string) => ({ id, title, context,
  url: "https://example.org/original", source: "Official publisher", evidenceClass: "official statistical data" as const,
  language: "Not applicable", timeLabel: "Observation date", timeValue: "2026-10-12", summaryEligible: false });
const result = (key: string, evidence: ReturnType<typeof official>[], status: ResearchSweepSourceResult["status"] = "complete") => ({
  key, label: key, query: "currency exchange rate", asOf: "2026-10-12T00:00:00Z", window: "Latest observation", status, error: null, evidence,
});

describe("selected country official context", () => {
  it("keeps only the selected currency and country series with original dates", () => {
    const results = [
      result("ecb-reference", [official("ecb-reference:USD:2026-10-12", "1 EUR = 1.1 USD", "USD per euro."), official("ecb-reference:KRW:2026-10-12", "1 EUR = 1490 KRW", "KRW per euro.")]),
      result("bis-effective-exchange", [official("bis-eer:US:N:2026-08", "US nominal index", "Index 101.72 (2020 = 100)."), official("bis-eer:KR:N:2026-08", "Korea nominal index", "Index 89.15 (2020 = 100). More detail."), official("bis-eer:KR:R:2026-08", "Korea real index", "Index 89.89 (2020 = 100).")]),
      result("world-bank-macro", [official("world-bank:FP.CPI.TOTL.ZG:USA:2025", "US inflation", "2% annual change."), official("world-bank:FP.CPI.TOTL.ZG:KOR:2025", "Korea inflation", "3% annual change.")]),
    ] as ResearchSweepSourceResult[];
    const selected = selectedCountryContext(results, "KR");
    expect(selected.map(({ item }) => item.id)).toEqual(["ecb-reference:KRW:2026-10-12", "bis-eer:KR:N:2026-08"]);
    expect(selected[1].brief).toBe("Index 89.15 (2020 = 100).");
    expect(selected[0].item.timeValue).toBe("2026-10-12");
  });

  it("never promotes unavailable or unrelated country rows", () => {
    const results = [result("ecb-reference", [official("ecb-reference:KRW:2026-10-12", "KRW", "Reference.")], "unavailable"),
      result("world-bank-macro", [official("world-bank:FP.CPI.TOTL.ZG:USA:2025", "US", "2% annual change.")])];
    expect(selectedCountryContext(results as ResearchSweepSourceResult[], "KR")).toEqual([]);
    expect(selectedCountryContext(results as ResearchSweepSourceResult[], "unknown")).toEqual([]);
  });
});
