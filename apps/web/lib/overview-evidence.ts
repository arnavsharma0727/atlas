import type { ResearchSweepSourceResult } from "./research-sweep";
import { hasMarketSignalTerms, hasTopicSignalTerms, isIndependentDiscussionEvidence, selectBalancedEvidence, type ModelEvidence } from "./market-summary";

/** Select both sides from the immutable search invocation, never the previous render's lens. */
export function selectOverviewEvidence(
  results: ResearchSweepSourceResult[],
  citationIds: Map<string, string>,
  search: { topic: string; localTopic: string; selectedLanguage: string },
) {
  const baselineResults = results.filter(({ key }) => !key.startsWith("local:") &&
    !["global-voices", "world-bank-macro", "eia-energy-prices", "bis-effective-exchange"].includes(key) && !key.startsWith("the-conversation:"));
  const localResults = results.filter(({ key }) => key.startsWith("local:") && key !== "local:global-voices" && !key.startsWith("local:the-conversation:"));
  const includedKeys = new Set<string>();
  const excludedCounts = { baseline: 0, selected: 0 };
  const candidateCounts: Record<string, number> = {};
  const onCandidate = (sourceKey: string) => { candidateCounts[sourceKey] = (candidateCounts[sourceKey] ?? 0) + 1; };
  const eligible = (topic: string) => (item: ModelEvidence) =>
    isIndependentDiscussionEvidence(item) && hasMarketSignalTerms(item) && hasTopicSignalTerms(item.excerpt, topic);
  const evidence = {
    us: selectBalancedEvidence(baselineResults, citationIds, 8, includedKeys, "en", eligible(search.topic), () => excludedCounts.baseline++, onCandidate),
    local: selectBalancedEvidence(localResults, citationIds, 8, includedKeys, search.selectedLanguage, eligible(search.localTopic), () => excludedCounts.selected++, onCandidate),
  };
  return { evidence, excludedCounts, candidateCounts };
}
