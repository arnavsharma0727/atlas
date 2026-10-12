import { describe, expect, it } from "vitest";
import { extractSummaryNumericTokens, summaryNumericSupportFailure } from "./summary-numeric-support";

describe("summary numeric audit support", () => {
  it("keeps full identifier digits, attached scales, signs, grouping and fullwidth forms", () => {
    expect(extractSummaryNumericTokens("RTX4090 50bn −5 +5 -5 1,200.5 ２０２６ 25%")).toEqual(["4090", "50", "-5", "+5", "-5", "1200.5", "2026", "25%"]);
    expect(extractSummaryNumericTokens("RTX5090")).not.toContain("090");
    expect(summaryNumericSupportFailure("Growth is 5%.", ["Growth is −5%."])).toBe("number-not-quoted");
    expect(extractSummaryNumericTokens(".5 -.25 1.2e5 5e-6")).toEqual([".5", "-.25", "1.2e5", "5e-6"]);
    expect(summaryNumericSupportFailure("Growth is 5%.", ["Growth is .5%."])).toBe("number-not-quoted");
    expect(summaryNumericSupportFailure("Capacity is 5e6.", ["Capacity was 5 and then 6."])).toBe("number-not-quoted");
  });
  it("rejects a number absent from the displayed supporting quotes", () => {
    expect(summaryNumericSupportFailure("Demand score was 65.6 in 2026.", ["The demand score was 65.6."])).toBe("number-not-quoted");
    expect(summaryNumericSupportFailure("Demand score was 65.6.", ["The demand score was 65.6."])).toBeNull();
  });
  it.each([
    ["Debt is $5 billion.", "Debt is $5 million."],
    ["Debt is €5 million.", "Debt is $5 million."],
    ["Rates rose 25 percentage points.", "Rates rose 25 basis points."],
    ["Demand rose 25 percent.", "Demand rose 25 bps."],
    ["Revenue is 5 billion.", "Revenue is 5 million."],
    ["Revenue is 5.", "Revenue is 5 million."],
    ["Debt is 5 USD.", "Debt is 5 EUR."],
  ])("does not substitute or silently omit units: %s", (claim, quote) => {
    expect(summaryNumericSupportFailure(claim, [quote])).toBe("quantity-unit-mismatch");
  });
  it.each([
    ["Debt is $5 million.", "Debt is $5 million according to this post."],
    ["Rates rose 25 basis points.", "Rates rose 25 basis points this year."],
    ["Revenue is 5bn.", "Revenue is 5bn this quarter."],
    ["Capacity is 1,200.", "Capacity is 1200 in this post."],
    ["Inflation is 5%.", "Inflation is 5% per this source."],
    ["Production fell -5%.", "Production fell -5% in the post."],
  ])("accepts matching literal quantities without outside conversions: %s", (claim, quote) => {
    expect(summaryNumericSupportFailure(claim, [quote])).toBeNull();
  });
  it("does not claim general semantic entailment or support localized numeral conversion", () => {
    expect(summaryNumericSupportFailure("Profits rose 5 percent.", ["Profits fell 5 percent."])).toBeNull();
    expect(summaryNumericSupportFailure("Inflation is 5 percent.", ["Inflation is ५ percent."])).toBe("number-not-quoted");
  });
});
