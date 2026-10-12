import { describe, expect, it } from "vitest";
import { comparisonReadiness } from "./comparison-readiness";

const breadth = (excerptCount: number, ...platformLabels: string[]) => ({ excerptCount, platformLabels });

describe("comparisonReadiness", () => {
  it("does not compare a lens with itself", () => expect(comparisonReadiness(breadth(5, "Bluesky"), breadth(5, "Bluesky"), true).state).toBe("insufficient"));
  it("rejects a missing country side", () => expect(comparisonReadiness(breadth(4, "Bluesky"), breadth(0)).state).toBe("insufficient"));
  it("labels thin and single-platform evidence limited", () => expect(comparisonReadiness(breadth(4, "Bluesky", "Lemmy"), breadth(4, "Mastodon")).state).toBe("limited"));
  it("allows a sampled cross-community comparison without claiming a national sample", () => {
    const result = comparisonReadiness(breadth(3, "Bluesky", "Lemmy"), breadth(3, "Bluesky", "Mastodon"));
    expect(result.state).toBe("cross-community");
    expect(result.note).toContain("do not verify author location");
  });
});
