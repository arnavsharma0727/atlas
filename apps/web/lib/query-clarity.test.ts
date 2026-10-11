import { describe, expect, it } from "vitest";
import { inspectQueryClarity } from "./query-clarity";

describe("market query clarity", () => {
  it("flags short tickers and common words without changing the query", () => {
    expect(inspectQueryClarity("CAT")).toMatchObject({
      isAmbiguous: true,
      warning: expect.stringContaining("does not infer a company"),
      suggestedAlias: "Caterpillar",
    });
    expect(inspectQueryClarity("EV").suggestedAlias).toBe("electric vehicle");
    expect(inspectQueryClarity("cat")).toMatchObject({ isAmbiguous: true, suggestedAlias: null });
  });

  it("offers an explicit alias for a ticker inside a longer exact phrase", () => {
    expect(inspectQueryClarity("$NVDA export controls").suggestedAlias).toBe("NVIDIA export controls");
  });

  it("does not suggest aliases or warn on a sufficiently specific phrase", () => {
    expect(inspectQueryClarity("semiconductor export controls")).toEqual({
      isAmbiguous: false,
      warning: null,
      suggestedAlias: null,
    });
  });

  it("does not choose between multiple possible aliases", () => {
    expect(inspectQueryClarity("CAT and META").suggestedAlias).toBeNull();
  });
});
