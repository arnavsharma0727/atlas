import { describe, expect, it } from "vitest";
import { hasMaterialEvidenceContext } from "./evidence-context";

describe("material evidence context", () => {
  it("surfaces external-link provenance caveats to the researcher", () => {
    expect(hasMaterialEvidenceContext("This post includes an external link; its text may quote or preview linked material and does not establish the author's independent view.")).toBe(true);
    expect(hasMaterialEvidenceContext("This excerpt matches a high-confidence stock-promotion/clickbait phrase screen; excluded from AI overview.")).toBe(true);
    expect(hasMaterialEvidenceContext("Provider language was missing; this excerpt matched the selected ko language lens by script only.")).toBe(true);
    expect(hasMaterialEvidenceContext("Answer excerpt shortened and HTML formatting removed for display.")).toBe(true);
    expect(hasMaterialEvidenceContext("Lemmy federated search; instance hosting does not establish poster nationality or residence.")).toBe(false);
    expect(hasMaterialEvidenceContext(undefined)).toBe(false);
  });
});
