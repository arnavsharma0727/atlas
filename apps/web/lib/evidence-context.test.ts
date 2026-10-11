import { describe, expect, it } from "vitest";
import { hasMaterialEvidenceContext } from "./evidence-context";

describe("material evidence context", () => {
  it("surfaces external-link provenance caveats to the researcher", () => {
    expect(hasMaterialEvidenceContext("This post includes an external link; its text may quote or preview linked material and does not establish the author's independent view.")).toBe(true);
    expect(hasMaterialEvidenceContext("Lemmy federated search; instance hosting does not establish poster nationality or residence.")).toBe(false);
    expect(hasMaterialEvidenceContext(undefined)).toBe(false);
  });
});
