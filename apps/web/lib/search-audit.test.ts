import { describe, expect, it } from "vitest";
import { buildSearchAudit } from "./search-audit";
import type { ResearchSweepSourceResult } from "./research-sweep";

function fixture() {
  const result: ResearchSweepSourceResult = {
    key: "lemmy:lemmy.world", label: "PRIVATE_LABEL", query: "solar", asOf: "2026-10-12T00:00:00Z",
    retrievedAt: "2026-10-12T00:00:01Z", window: "7 days", status: "complete", error: null,
    providerReturnedCount: 8, adapterExcludedCount: 3, topicExcludedCount: 4,
    sourceNote: "PRIVATE_NOTE", coverageNote: "PRIVATE_COVERAGE", evidence: [{
      id: "PRIVATE_ID", url: "https://example.test/@PRIVATE_HANDLE/post/1", title: "PRIVATE_TITLE",
      transientPreview: "PRIVATE_EXCERPT", attribution: "PRIVATE_AUTHOR", attributionUrl: "https://example.test/PRIVATE_PROFILE",
      context: "PRIVATE_CONTEXT", researcherNote: "PRIVATE_RESEARCH", source: "PRIVATE_SOURCE",
      sourceOperatorKey: "lemmy-federation", language: "en", timeLabel: "Published", timeValue: "2026-10-11T00:00:00Z", evidenceClass: "social discussion",
    }],
  };
  return {
    run: { id: "run-one", privateSalt: "PRIVATE_SALT_123456789012345678901234567890" }, deploymentCommit: "abcdef1",
    topic: "solar", localQuery: "solar", countryCode: "US", language: "en", queryMethod: "baseline",
    results: [result], candidateCounts: { "lemmy:lemmy.world": 1 }, overviewInputIds: ["C1"],
    summary: {
      usSummary: { text: "PRIVATE_SUMMARY", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "PRIVATE_QUOTE" }] },
      localSummary: { text: "PRIVATE_LOCAL", citations: [] }, comparison: { text: "PRIVATE_COMPARISON", citations: [] }, limitations: ["PRIVATE_LIMITATION"],
    }, summaryMode: "ai" as const,
  };
}

describe("local search audit", () => {
  it("does not infer a grounding check from AI mode alone", async () => {
    expect((await buildSearchAudit(fixture())).summary.groundingCheck).toBeNull();
  });

  it("exports only the grounding status allowlist, never extra model fields", async () => {
    const input = fixture();
    const groundingCheck = { state: "model-check-passed" as const, claimCount: 1, independentValidation: false as const, privateText: "PRIVATE_REVIEW" };
    const summary = { ...input.summary, groundingCheck };
    const audit = await buildSearchAudit({ ...input, summary });
    expect(audit.summary.groundingCheck).toEqual({ state: "model-check-passed", claimCount: 1, independentValidation: false });
    expect(JSON.stringify(audit)).not.toContain("PRIVATE_");
    groundingCheck.claimCount = 8;
    expect((await buildSearchAudit({ ...input, summary })).summary.groundingCheck).toBeNull();
    groundingCheck.claimCount = 1;
    expect((await buildSearchAudit({ ...input, summary, summaryMode: "evidence" })).summary.groundingCheck).toBeNull();
  });
  it("exports only an explicit metadata allowlist, not content or attribution", async () => {
    const snapshot = await buildSearchAudit(fixture(), "2026-10-12T00:00:02Z");
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
    expect(snapshot.deploymentCommit).toBe("abcdef1");
    expect(snapshot.summary.passages[0]).toEqual({ key: "baseline", citationIds: ["C1"], supportingQuoteCount: 1 });
    expect(snapshot.sources[0]).toMatchObject({ providerReturnedCount: 8, sourceSafetyExcludedCount: 3, topicExcludedCount: 4, displayedUniqueCount: 1, overviewCandidateCount: 1 });
    expect(snapshot.sources[0].records[0]).toMatchObject({ citationId: "C1", overviewSelected: true, citedBy: ["baseline"], displayed: true });
    expect(snapshot.sources[0].records[0].originalFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("preserves exact queries and makes their sharing risk explicit", async () => {
    const input = fixture();
    input.topic = "my sensitive research query";
    const snapshot = await buildSearchAudit(input);
    expect(snapshot.search.topic).toBe(input.topic);
    expect(snapshot.limits.join(" ")).toContain("sensitive information you entered");
  });

  it("links separately rendered claims to originals without retaining any claim wording", async () => {
    const input = fixture();
    const summary = { ...input.summary, usSummary: {
      text: "PRIVATE_COMBINED", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "PRIVATE_QUOTE" }],
      claims: [
        { text: "PRIVATE_CLAIM_ONE", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "PRIVATE_QUOTE_ONE" }] },
        { text: "PRIVATE_CLAIM_TWO", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "PRIVATE_QUOTE_TWO" }] },
      ],
    } };
    const snapshot = await buildSearchAudit({ ...input, summary });
    expect(snapshot.summary.claims).toEqual([
      { id: "baseline-1", passage: "baseline", citationIds: ["C1"], supportingQuoteCount: 1 },
      { id: "baseline-2", passage: "baseline", citationIds: ["C1"], supportingQuoteCount: 1 },
    ]);
    expect(snapshot.sources[0].records[0].citedByClaims).toEqual(["baseline-1", "baseline-2"]);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
    expect((await buildSearchAudit({ ...input, summary, summaryMode: "evidence" })).summary.claims).toEqual([]);
  });

  it("links federation copies within a run, but not across independently salted runs", async () => {
    const input = fixture();
    const copy = { ...input.results[0], key: "local:lemmy:jlai.lu", evidence: [{ ...input.results[0].evidence[0], url: `${input.results[0].evidence[0].url}?source=federation&utm_source=copy` }] };
    input.results.push(copy);
    const first = await buildSearchAudit(input);
    const repeated = await buildSearchAudit(input);
    const fingerprint = first.sources[0].records[0].originalFingerprint;
    expect(first.sources[1].records[0].originalFingerprint).toBe(fingerprint);
    expect(first.sources[1].records[0].displayed).toBe(false);
    expect(first.sources[1].duplicateSuppressedCount).toBe(1);
    expect(repeated.sources[0].records[0].originalFingerprint).toBe(fingerprint);
    const other = await buildSearchAudit({ ...input, run: { id: "run-two", privateSalt: "different-secret-salt-12345678901234567890" } });
    expect(other.sources[0].records[0].originalFingerprint).not.toBe(fingerprint);
  });

  it("does not turn an unavailable or unsearched source into a zero-return observation", async () => {
    const input = fixture();
    input.results = ["unavailable", "not-searched"].map((status) => ({ ...input.results[0], status: status as ResearchSweepSourceResult["status"], evidence: [], providerReturnedCount: status === "not-searched" ? 0 : undefined, adapterExcludedCount: status === "not-searched" ? 0 : undefined, topicExcludedCount: status === "not-searched" ? 0 : undefined, error: "PRIVATE_ERROR" }));
    const snapshot = await buildSearchAudit(input);
    for (const source of snapshot.sources) {
      expect(source.providerReturnedCount).toBeNull();
      expect(source.sourceSafetyExcludedCount).toBeNull();
      expect(source.topicExcludedCount).toBeNull();
    }
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_ERROR");
  });

  it("does not leak a malformed deployment value or accept weak fingerprint salts", async () => {
    expect((await buildSearchAudit({ ...fixture(), deploymentCommit: "PRIVATE_SECRET" })).deploymentCommit).toBeNull();
    await expect(buildSearchAudit({ ...fixture(), run: { id: "run", privateSalt: "" } })).rejects.toThrow("ephemeral search identity");
  });
});
