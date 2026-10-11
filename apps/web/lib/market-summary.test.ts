import { describe, expect, it } from "vitest";
import { flagRepeatedEvidenceViews, isNearDuplicateExcerpt, normalizeMarketSummary, redactSummaryExcerpt, selectBalancedEvidence } from "./market-summary";
import { citationKey } from "./perspective-snapshot";
import type { ResearchSweepSourceResult } from "./research-sweep";

function result(key: string, source: string, evidence: ResearchSweepSourceResult["evidence"]): ResearchSweepSourceResult {
  return { key, label: source, query: "solar", asOf: "2026-10-10T00:00:00.000Z", retrievedAt: "2026-10-10T00:00:01.000Z", window: "7 days", evidence, error: null, status: "complete" };
}

function evidence(id: string, source: string, excerpt: string, operator = source) {
  return {
    id, title: `Post by @private-handle-${id}`, url: `https://example.test/${id}`, source,
    evidenceClass: "social discussion" as const, language: "English", timeLabel: "Published",
    timeValue: "2026-10-10T00:00:00.000Z", transientPreview: excerpt,
    sourceOperatorKey: operator,
  };
}

describe("market summary evidence contracts", () => {
  it("redacts embedded links, emails, and handles from excerpts before model submission", () => {
    expect(redactSummaryExcerpt("Shared by (@market.reader), contact analyst@example.org or https://example.org/report.")).toBe("Shared by ([handle]), contact [email] or [link]");
  });

  it("flags overlapping provider views without reducing their returned record counts", () => {
    const original = evidence("a", "Lemmy", "same public post", "lemmy-federation");
    const repeated = { ...evidence("b", "Lemmy", "SAME PUBLIC POST", "lemmy-federation"), url: original.url };
    const [first, second] = flagRepeatedEvidenceViews([
      result("lemmy:a", "Lemmy A", [original]),
      result("lemmy:b", "Lemmy B", [repeated]),
    ]);
    expect(first.evidence).toHaveLength(1);
    expect(first.sourceNote).toContain("1 of 1 returned records also appear");
    expect(first.evidence[0].context).toContain("Same source URL appears in 2 query/server views");
    expect(second.sourceNote).toContain("not independent evidence");
  });

  it("deduplicates the same DOI across independent metadata providers", () => {
    const doi = "https://doi.org/10.1234/shared-paper.1";
    const crossref = { ...evidence("doi-a", "Crossref", "A scholarly record", "crossref"), url: doi };
    const openalex = { ...evidence("doi-b", "OpenAlex", "The same scholarly record", "openalex"), url: "https://DOI.org/10.1234/shared-paper.1?utm_source=atlas#metadata" };
    const results = flagRepeatedEvidenceViews([
      result("crossref", "Crossref", [crossref]),
      result("openalex", "OpenAlex", [openalex]),
    ]);
    expect(results[1].evidence[0].context).toContain("Same source URL appears in 2 query/server views");
    const citations = new Map([
      [citationKey("crossref", "doi-a"), "C1"],
      [citationKey("openalex", "doi-b"), "C2"],
    ]);
    expect(selectBalancedEvidence(results, citations)).toHaveLength(1);
  });

  it("flags and excludes only long, near-identical copies from model evidence while keeping both citations visible", () => {
    const firstText = "Investors described demand for advanced chips as strong while warning that export restrictions could constrain shipments across major markets this quarter. Companies are watching order trends, inventory levels, and customer spending before changing their outlook. This remains uncertain.";
    const secondText = firstText.replace("This remains uncertain.", "The outlook remains uncertain.");
    expect(isNearDuplicateExcerpt(firstText, secondText)).toBe(true);
    expect(isNearDuplicateExcerpt("short post", "short post with a few words added")).toBe(false);
    expect(isNearDuplicateExcerpt(firstText, "Investors discussed a different commodity market after supply disruptions affected shipping costs. Traders disagreed about potential demand, inventories, company guidance, and future pricing trends across regions.")).toBe(false);
    const japaneseText = "半導体市場では投資家が需要の見通しと在庫水準を慎重に見極めています。輸出規制や顧客の支出が今後の出荷に影響する可能性があり、複数の企業は次の四半期まで大きな判断を保留しています。".repeat(2);
    expect(isNearDuplicateExcerpt(japaneseText, japaneseText.replace("慎重に見極めています", "注意深く確認しています"))).toBe(true);
    const a = evidence("a", "Bluesky", firstText, "bluesky");
    const b = { ...evidence("b", "Bluesky", secondText, "bluesky"), url: "https://example.test/other" };
    const results = flagRepeatedEvidenceViews([
      result("blue:one", "Bluesky", [a]),
      result("blue:two", "Bluesky", [b]),
    ]);
    expect(results.flatMap(({ evidence: items }) => items)).toHaveLength(2);
    expect(results[0].evidence[0].context).toContain("Near-identical long-form text");
    const citations = new Map([
      [citationKey("blue:one", "a"), "C1"],
      [citationKey("blue:two", "b"), "C2"],
    ]);
    expect(selectBalancedEvidence(results, citations, 8)).toHaveLength(1);
  });

  it("balances distinct operators and omits source URLs, attribution handles, and authors from model input", () => {
    const results = [
      result("blue", "Bluesky", [evidence("b1", "Bluesky", "A first view from (@member123.example), contact analyst@private.example.", "bluesky"), evidence("b2", "Bluesky", "A second view", "bluesky")]),
      result("lemmy", "Lemmy · lemmy.world", [evidence("l1", "Lemmy · lemmy.world", "A forum view", "lemmy-federation")]),
      result("mastodon", "Mastodon · mastodon.social", [evidence("m1", "Mastodon · mastodon.social", "A hashtag view", "mastodon-network")]),
    ];
    const citations = new Map([
      [citationKey("blue", "b1"), "C1"], [citationKey("blue", "b2"), "C2"],
      [citationKey("lemmy", "l1"), "C3"], [citationKey("mastodon", "m1"), "C4"],
    ]);
    const selected = selectBalancedEvidence(results, citations, 3);
    expect(selected.map(({ citationId }) => citationId)).toEqual(["C1", "C3", "C4"]);
    expect(selected[0]).toMatchObject({ title: "Public discussion post", excerpt: "A first view from ([handle]), contact [email]." });
    expect(JSON.stringify(selected)).not.toContain("https://");
    expect(JSON.stringify(selected)).not.toContain("private-handle");
    expect(JSON.stringify(selected)).not.toContain("@member123");
    expect(JSON.stringify(selected)).not.toContain("analyst@private.example");
  });

  it("never sends headline-only expert-analysis records to the discussion summarizer", () => {
    const headline = { ...evidence("tc", "The Conversation · Australia edition", "", "the-conversation"), transientPreview: undefined, evidenceClass: "expert analysis" as const };
    const results = [result("the-conversation:au", "The Conversation · Australia", [headline])];
    const citations = new Map([[citationKey("the-conversation:au", "tc"), "C1"]]);
    expect(selectBalancedEvidence(results, citations)).toEqual([]);
  });

  it("never sends title-only Crossref literature metadata to the discussion summarizer", () => {
    const literature = { ...evidence("paper", "Crossref", "", "crossref"), transientPreview: undefined, evidenceClass: "research literature" as const };
    const results = [result("crossref", "Crossref research literature", [literature])];
    const citations = new Map([[citationKey("crossref", "paper"), "C1"]]);
    expect(selectBalancedEvidence(results, citations)).toEqual([]);
  });


  it("collapses exact copies within one source operator but retains distinct wording", () => {
    const results = [result("one", "Lemmy A", [evidence("a", "Lemmy A", "same words", "lemmy-federation")]), result("two", "Lemmy B", [
      evidence("b", "Lemmy B", " SAME   WORDS ", "lemmy-federation"),
      evidence("c", "Lemmy B", "similar but not identical", "lemmy-federation"),
    ])];
    const citations = new Map([
      [citationKey("one", "a"), "C1"], [citationKey("two", "b"), "C2"], [citationKey("two", "c"), "C3"],
    ]);
    expect(selectBalancedEvidence(results, citations).map(({ citationId }) => citationId)).toEqual(["C1", "C3"]);
  });

  it("does not send a repeated post as evidence for both sides of a comparison", () => {
    const shared = evidence("a", "Bluesky", "same post", "bluesky");
    const base = result("base", "Bluesky", [shared]);
    const local = result("local", "Bluesky", [{ ...shared, id: "b" }]);
    const citations = new Map([[citationKey("base", "a"), "C1"], [citationKey("local", "b"), "C2"]]);
    const selectedKeys = new Set<string>();
    const firstSide = selectBalancedEvidence([base], citations, 8, selectedKeys);
    const secondSide = selectBalancedEvidence([local], citations, 8, selectedKeys);
    expect(firstSide.map(({ citationId }) => citationId)).toEqual(["C1"]);
    expect(secondSide).toEqual([]);
  });

  it("accepts only citations present in the corresponding submitted evidence group", () => {
    const summary = normalizeMarketSummary({
      usSummary: "The English-language records mention supply constraints.", usCitations: ["C1", "C99"],
      localSummary: "The selected-language records discuss prices.", localCitations: ["C2"],
      comparison: "These samples are not directly comparable.", comparisonCitations: ["C1", "C2"],
      limitations: ["Not representative"],
    }, { us: new Set(["C1"]), local: new Set(["C2"]) });
    expect(summary?.usSummary.citations).toEqual(["C1"]);
    expect(summary?.comparison.citations).toEqual(["C1", "C2"]);
  });

  it("uses deterministic non-claiming text for a side with no submitted evidence", () => {
    const summary = normalizeMarketSummary({
      usSummary: "Investors universally expect growth.", usCitations: [],
      localSummary: "Local view", localCitations: ["C2"],
      comparison: "The two groups disagree.", comparisonCitations: ["C2"],
      limitations: [],
    }, { us: new Set(), local: new Set(["C2"]) });
    expect(summary?.usSummary.text).toContain("No text-bearing records were submitted");
    expect(summary?.usSummary.text).toContain("baseline overview");
    expect(summary?.comparison.text).toContain("comparison is not available");
    expect(summary?.comparison.citations).toEqual(["C2"]);
  });

  it("rejects unsupported or uncited passages when evidence was supplied", () => {
    const value = {
      usSummary: "The sample proves investors are bullish.", usCitations: [],
      localSummary: "No records were returned.", localCitations: [],
      comparison: "Not comparable.", comparisonCitations: [], limitations: [],
    };
    expect(normalizeMarketSummary(value, { us: new Set(["C1"]), local: new Set() })).toBeNull();
  });
});
