import type { EvidenceBreadth } from "./market-summary";

export type ComparisonReadiness = {
  state: "insufficient" | "limited" | "cross-community";
  label: string;
  note: string;
};

/** This assesses evidence coverage, not the truth of a claim or author geography. */
export function comparisonReadiness(
  baseline: EvidenceBreadth | undefined,
  selected: EvidenceBreadth | undefined,
  sameLens = false,
): ComparisonReadiness {
  if (sameLens) return {
    state: "insufficient",
    label: "Choose another country to compare",
    note: "The English-language baseline is not a verified U.S. sample; selecting it twice adds no second perspective.",
  };
  if (!baseline?.excerptCount || !selected?.excerptCount) return {
    state: "insufficient",
    label: "Not enough evidence to compare",
    note: "One side has no qualifying public discussion. An empty result is a coverage limit, not evidence of agreement or absence.",
  };
  if (baseline.excerptCount < 3 || selected.excerptCount < 3 || baseline.platformLabels.length < 2 || selected.platformLabels.length < 2) return {
    state: "limited",
    label: "Limited comparison",
    note: "At least one side has fewer than three selected excerpts or fewer than two platforms. Treat the overview as source-specific observations.",
  };
  return {
    state: "cross-community",
    label: "Cross-community sample",
    note: "Both sides have multiple excerpts and platforms. Language and platform membership still do not verify author location or represent a country.",
  };
}
