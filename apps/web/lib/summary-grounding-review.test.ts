import { describe, expect, it } from "vitest";
import { groundingClaims, groundingReviewPrompt, GROUNDING_REVIEW_SYSTEM, parseGroundingReview } from "./summary-grounding-review";
import type { MarketSummary } from "./market-summary";

const claim = { id: "baseline:1", text: "One post reports uncertain demand.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "Demand is uncertain" }] };
const good = { coverage: "adequate", claims: [{ id: claim.id, verdict: "supported", reason: "none" }] };

describe("summary grounding review protocol", () => {
  it("accepts a complete supported review without calling it independent validation", () => {
    expect(parseGroundingReview(good, [claim])).toEqual({ passed: true, rejectedClaimCount: 0, reasons: [] });
  });
  it.each(["numeric-relationship", "negation", "time", "actor", "scope", "comparison", "counterevidence", "other"])("withholds a claim rejected for %s", (reason) => {
    expect(parseGroundingReview({ ...good, claims: [{ id: claim.id, verdict: "unsupported", reason }] }, [claim]))
      .toEqual({ passed: false, rejectedClaimCount: 1, reasons: [reason] });
  });
  it("withholds uncertain claims and uncertain coverage", () => {
    expect(parseGroundingReview({ ...good, claims: [{ id: claim.id, verdict: "uncertain", reason: "other" }] }, [claim])?.passed).toBe(false);
    for (const coverage of ["uncertain", "material-omission"]) {
      expect(parseGroundingReview({ ...good, coverage }, [claim])).toEqual({ passed: false, rejectedClaimCount: 0, reasons: ["counterevidence"] });
    }
  });
  it.each([null, [], {}, { ...good, claims: [] }, { ...good, coverage: "verified" },
    { ...good, claims: [{ ...good.claims[0], id: "local:1" }] },
    { ...good, claims: [good.claims[0], good.claims[0]] },
    { ...good, claims: [{ ...good.claims[0], verdict: true }] },
    { ...good, claims: [{ ...good.claims[0], reason: "numeric-relationship" }] },
    { ...good, claims: [{ ...good.claims[0], verdict: "unsupported" }] },
  ])("rejects malformed, incomplete or inconsistent review %#", (value) => {
    expect(parseGroundingReview(value, [claim])).toBeNull();
  });
  it("rejects duplicate IDs even with the expected number of verdicts", () => {
    expect(parseGroundingReview({ coverage: "adequate", claims: [good.claims[0], good.claims[0]] }, [claim, { ...claim, id: "baseline:2" }])).toBeNull();
  });
  it("assigns every generated claim a stable group ID and skips no-evidence fallback passages", () => {
    const passage = { text: claim.text, citations: claim.citations, supportingQuotes: claim.supportingQuotes };
    const summary: MarketSummary = { usSummary: { ...passage, claims: [passage, { ...passage, text: "A different view." }] }, localSummary: passage, comparison: passage, limitations: [] };
    expect(groundingClaims(summary, { us: 2, local: 0 }).map(({ id }) => id)).toEqual(["baseline:1", "baseline:2"]);
    expect(groundingClaims(summary, { us: 2, local: 1 }).map(({ id }) => id)).toEqual(["baseline:1", "baseline:2", "local:1", "comparison:1"]);
    expect(groundingClaims(summary, { us: 0, local: 0 })).toEqual([]);
  });
  it("asks for meaning rather than quote presence and treats model content as untrusted", () => {
    expect(GROUNDING_REVIEW_SYSTEM).toContain("upgrade from versus upgrade to");
    expect(GROUNDING_REVIEW_SYSTEM).toContain("negation");
    expect(GROUNDING_REVIEW_SYSTEM).toContain("posting time");
    expect(GROUNDING_REVIEW_SYSTEM).toContain("untrusted data");
    expect(GROUNDING_REVIEW_SYSTEM).toContain("64 GB");
    expect(GROUNDING_REVIEW_SYSTEM).toContain("$4000");
    expect(GROUNDING_REVIEW_SYSTEM).toContain("never that the source is truthful");
    expect(groundingReviewPrompt([claim], { baseline: [{ excerpt: "Demand is uncertain" }] })).toContain("material-omission");
  });
});
