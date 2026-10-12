import { describe, expect, it } from "vitest";
import { evaluateResearchAcceptance, type AcceptanceClaimRow, type AcceptanceResultRow, type AcceptanceSourceRow } from "./research-acceptance";

const lenses = ["English", "Korean", "Japanese", "German", "French", "Portuguese", "Hindi", "Spanish"];

function completeFixture() {
  const sources: AcceptanceSourceRow[] = [];
  const results: AcceptanceResultRow[] = [];
  const claims: AcceptanceClaimRow[] = [];
  for (const lens of lenses) {
    let reviewed = 0;
    for (let topic = 0; topic < 10; topic++) {
      for (let day = 0; day < 3; day++) {
        const runId = `${lens}-${topic}-${day}`;
        const runDate = `2026-10-${String(1 + day).padStart(2, "0")}T12:00:00Z`;
        for (const provider of ["provider-a", "provider-b"]) sources.push({
          run_id: runId, run_date_utc: runDate, deployed_commit: "abc1234", topic_label: `topic-${topic}`,
          baseline_query: `topic-${topic}`, local_query: lens === "English" ? `topic-${topic}` : `${lens} topic-${topic}`, selected_lens: lens,
          provider_key: provider, source_operator_key: provider, is_community_discussion: "yes",
          provider_status: "complete", ui_status_accurate: "yes", raw_returned_count: "5",
          accepted_count: "5", excluded_count: "0",
        });
        if (day === 2 && topic === 9) continue;
        for (const provider of ["provider-a", "provider-b"]) {
          if (reviewed >= 50) break;
          const duplicate = reviewed < 2;
          const relevant = reviewed % 50 >= 4;
          results.push({
            run_id: runId, selected_lens: lens, topic_label: `topic-${topic}`, provider_key: provider,
            source_operator_key: provider, result_id: `${runId}-${provider}`, atlas_included: "yes",
            atlas_summary_included: relevant && !duplicate ? "yes" : "no",
            atlas_duplicate_flagged: duplicate ? "yes" : "no", reviewer_1_fluent: "yes", reviewer_2_fluent: "yes",
            reviewer_1_topic_match: relevant ? "yes" : "no", reviewer_2_topic_match: relevant ? "yes" : "no",
            adjudicated_topic_match: relevant ? "yes" : "no", reviewer_1_market_relevance: relevant ? "yes" : "no",
            reviewer_2_market_relevance: relevant ? "yes" : "no", adjudicated_market_relevance: relevant ? "yes" : "no",
            reviewer_1_geography_overclaim: reviewed === 2 ? "yes" : "no", reviewer_2_geography_overclaim: reviewed === 2 ? "yes" : "no",
            adjudicated_geography_overclaim: reviewed === 2 ? "yes" : "no", adjudicated_original_opinion: "yes",
            adjudicated_promotion_or_spam: "no",
            adjudicated_language_correct: "yes", source_link_accessible: "yes",
            adjudicated_duplicate: duplicate ? "yes" : "no",
            adjudicated_duplicate_group: duplicate ? `${runId}-dupe` : "",
          });
          reviewed++;
        }
      }
    }
  }
  for (const lens of lenses) {
    for (let index = 0; index < 10; index++) {
      const topic = index % 5;
      const day = index % 2;
      const runId = `${lens}-${topic}-${day}`;
      claims.push({
        run_id: runId, selected_lens: lens, claim_id: `claim-${lens}-${index}`,
        claim_type: lens !== "English" && index === 0 ? "comparison" : "overview",
        reviewer_1_fluent: "yes", reviewer_2_fluent: "yes",
        reviewer_1_citation_resolves: "yes", reviewer_2_citation_resolves: "yes",
        reviewer_1_exact_quote_present: "yes", reviewer_2_exact_quote_present: "yes",
        reviewer_1_semantic_support: "yes", reviewer_2_semantic_support: "yes",
        adjudicated_semantic_support: "yes", reviewer_1_unsupported_geography: "no",
        reviewer_1_describes_post_as_post: "yes", reviewer_2_describes_post_as_post: "yes", adjudicated_describes_post_as_post: "yes",
        reviewer_2_unsupported_geography: "no", adjudicated_unsupported_geography: "no",
        adjudicated_comparison_cites_both_sides: lens !== "English" && index === 0 ? "yes" : "",
        adjudicated_counterevidence_omitted: "no",
      });
    }
  }
  return { sources, results, claims };
}

describe("research acceptance evaluator", () => {
  it("does not pass an empty or unreviewed worksheet", () => {
    const report = evaluateResearchAcceptance({ sources: [], results: [], claims: [] });
    expect(report.scoreEligible).toBe(false);
    expect(report.gates.map(({ status }) => status)).toEqual(Array(11).fill("insufficient"));
  });

  it("passes only when schedule, coverage, agreement, precision, claims, duplicates, breadth, and status gates all pass", () => {
    const report = evaluateResearchAcceptance(completeFixture());
    expect(report.scoreEligible).toBe(true);
    expect(report.evidenceCounts).toMatchObject({ uniqueSearches: 240, topics: 10, resultReviews: 400, summaryClaims: 80 });
    expect(report.precision.overall.rate).toBeCloseTo(0.92);
    expect(report.summary.semanticSupport.rate).toBe(1);
    expect(report.evidenceIntegrity.issueCount).toBe(0);
    expect(report.summaryEvidenceByLens.Hindi.count).toBeGreaterThanOrEqual(10);
    expect(report.gates.map(({ status }) => status)).toEqual(Array(11).fill("pass"));
    expect(report.precision.overall.confidence95).toHaveLength(2);
  });

  it("fails a material summary-citation or geographic-integrity defect even with strong aggregate support", () => {
    const fixture = completeFixture();
    fixture.claims[0].adjudicated_unsupported_geography = "yes";
    fixture.claims[0].reviewer_1_citation_resolves = "no";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.scoreEligible).toBe(false);
    expect(report.gates[3].status).toBe("fail");
  });

  it("does not substitute executed searches for the diversity of actually reviewed results", () => {
    const fixture = completeFixture();
    for (const row of fixture.results.filter((result) => result.selected_lens === "Hindi")) {
      row.run_id = "Hindi-0-0";
      row.topic_label = "topic-0";
    }
    const report = evaluateResearchAcceptance(fixture);
    expect(report.lensCoverage.find((row) => row.lens === "Hindi")).toMatchObject({ reviewedRecords: 50, topicCount: 1, dateCount: 1 });
    expect(report.gates[0].status).toBe("insufficient");
  });

  it("does not count off-topic, promotional, wrong-language, or non-discussion records as operator breadth", () => {
    for (const defect of ["topic", "promotion", "language", "not-discussion"] as const) {
      const fixture = completeFixture();
      for (const row of fixture.results.filter((result) => result.provider_key === "provider-b")) {
        if (defect === "topic") row.adjudicated_topic_match = "no";
        if (defect === "promotion") row.adjudicated_promotion_or_spam = "yes";
        if (defect === "language") row.adjudicated_language_correct = "no";
      }
      if (defect === "not-discussion") {
        for (const row of fixture.sources.filter((source) => source.provider_key === "provider-b")) {
          row.is_community_discussion = "no";
          // Keep enough discussion volume to exercise the breadth gate.
        }
        for (const row of fixture.sources.filter((source) => source.provider_key === "provider-a")) row.raw_returned_count = "10";
      }
      const report = evaluateResearchAcceptance(fixture);
      expect(report.summary.operatorBreadth.rate).toBe(0);
      expect(report.gates[5].status).toBe("fail");
    }
  });

  it("does not let aggregate summary metrics hide a weak language lens", () => {
    const fixture = completeFixture();
    for (const row of fixture.claims.filter((claim) => claim.selected_lens === "Spanish").slice(0, 3)) {
      row.adjudicated_semantic_support = "no";
    }
    const report = evaluateResearchAcceptance(fixture);
    expect(report.summary.semanticSupport.rate).toBeCloseTo(0.9625);
    expect(report.claimCoverageByLens.Spanish.semanticSupport.rate).toBe(0.7);
    expect(report.gates[3].status).toBe("fail");
  });

  it("rejects duplicate or detached source/result/claim evidence identities", () => {
    const fixture = completeFixture();
    fixture.results.push({ ...fixture.results[0] });
    fixture.claims[0].run_id = "unlinked-run";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.gates[8].status).toBe("fail");
    expect(report.evidenceIntegrity.issues.join(" ")).toContain("duplicate sampled result identity");
    expect(report.evidenceIntegrity.issues.join(" ")).toContain("summary claim row(s) do not link");
  });

  it("requires source rows and sampled results to agree on one deployed version and source operator", () => {
    const fixture = completeFixture();
    fixture.sources[0].deployed_commit = "different-commit";
    fixture.results[0].source_operator_key = "unregistered-operator";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.gates[8].status).toBe("fail");
    expect(report.evidenceIntegrity.issues.join(" ")).toContain("conflicting topic/lens/date/query/commit metadata");
    expect(report.evidenceIntegrity.issues.join(" ")).toContain("source operator recorded for their provider");
  });

  it("requires reviewer-confirmed duplicate groups to contain at least two records", () => {
    const fixture = completeFixture();
    fixture.results[1].adjudicated_duplicate_group = "singleton-group";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.gates[4].status).toBe("insufficient");
    expect(report.summary.duplicateRecall.rate).toBe(1);
  });

  it("rejects promotional content selected into a language overview", () => {
    const fixture = completeFixture();
    const selected = fixture.results.find((row) => row.selected_lens === "English" && row.atlas_summary_included === "yes")!;
    selected.adjudicated_promotion_or_spam = "yes";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.summaryEvidenceByLens.English.unsuitable).toBe(1);
    expect(report.gates[9].status).toBe("fail");
  });

  it("marks missing fluent-review coverage as insufficient instead of scoring it as a pass", () => {
    const fixture = completeFixture();
    fixture.results[0].reviewer_1_fluent = "no";
    fixture.results[0].reviewer_2_fluent = "no";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.gates[0].status).toBe("insufficient");
    expect(report.gates[1].status).toBe("insufficient");
    expect(report.scoreEligible).toBe(false);
  });

  it("does not silently omit source rows with missing operational-status review", () => {
    const fixture = completeFixture();
    fixture.sources[0].provider_status = "";
    fixture.sources[0].ui_status_accurate = "";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.gates[6].status).toBe("insufficient");
    expect(report.scoreEligible).toBe(false);
  });

  it("requires adequate per-lens language-label accuracy instead of hiding a weak lens in an aggregate", () => {
    const fixture = completeFixture();
    for (const row of fixture.results.filter((result) => result.selected_lens === "Hindi").slice(0, 6)) {
      row.adjudicated_language_correct = "no";
    }
    const report = evaluateResearchAcceptance(fixture);
    expect(report.languageAccuracyByLens.Hindi.rate).toBeCloseTo(0.88);
    expect(report.gates[7].status).toBe("fail");
    expect(report.scoreEligible).toBe(false);
  });

  it("marks adjudication gaps as insufficient, not as negative precision or successful duplicate review", () => {
    const fixture = completeFixture();
    fixture.results[0].adjudicated_market_relevance = "";
    fixture.results[2].adjudicated_duplicate = "";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.gates[2].status).toBe("insufficient");
    expect(report.gates[4].status).toBe("insufficient");
  });

  it("reports duplicate-flag false positives separately from duplicate recall", () => {
    const fixture = completeFixture();
    fixture.results[2].atlas_duplicate_flagged = "yes";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.summary.duplicateRecall.rate).toBe(1);
    expect(report.summary.duplicateFlagPrecision.rate).toBeCloseTo(16 / 17);
    expect(report.gates[4].status).toBe("pass");
  });

  it("does not report unlabeled source links as accessible", () => {
    const fixture = completeFixture();
    fixture.results[0].source_link_accessible = "";
    fixture.results[1].source_link_accessible = "no";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.summary.sourceLinkAccessibility.numerator).toBe(398);
    expect(report.summary.sourceLinkAccessibility.denominator).toBe(399);
    expect(report.gates[10].status).toBe("insufficient");
  });

  it("does not pass duplicate detection when false-positive collapse is excessive", () => {
    const fixture = completeFixture();
    for (const result of fixture.results.slice(2, 20)) result.atlas_duplicate_flagged = "yes";
    const report = evaluateResearchAcceptance(fixture);
    expect(report.summary.duplicateRecall.rate).toBe(1);
    expect(report.summary.duplicateFlagPrecision.rate).toBeLessThan(0.9);
    expect(report.gates[4].status).toBe("fail");
  });
});
