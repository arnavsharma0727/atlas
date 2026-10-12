import { buildCitationIds, citationKey } from "./perspective-snapshot";
import { collapseRepeatedEvidenceViews, normalizeSourceUrl, type MarketSummary } from "./market-summary";
import type { ResearchSweepSourceResult } from "./research-sweep";

export type AuditRunIdentity = { id: string; privateSalt: string };

/** Explicit allowlist: never serialize a source/evidence/model object wholesale. */
export async function buildSearchAudit(input: {
  run: AuditRunIdentity;
  deploymentCommit: string | null;
  topic: string;
  localQuery: string;
  countryCode: string;
  language: string;
  queryMethod: string;
  results: ResearchSweepSourceResult[];
  candidateCounts: Record<string, number>;
  overviewInputIds: readonly string[];
  summary: MarketSummary;
  summaryMode: "ai" | "evidence" | "unavailable";
}, exportedAt = new Date().toISOString()) {
  if (!input.run.id || input.run.privateSalt.length < 32) throw new Error("An ephemeral search identity is required.");
  const citations = buildCitationIds(input.results);
  const views = collapseRepeatedEvidenceViews(input.results);
  const selected = new Set(input.overviewInputIds);
  const fingerprint = async (identity: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${input.run.privateSalt}\u0000${identity}`));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const passages = [
    ["baseline", input.summary.usSummary], ["selected", input.summary.localSummary], ["comparison", input.summary.comparison],
  ] as const;
  return {
    schema: "atlas-search-audit/v1",
    runId: input.run.id,
    exportedAt,
    deploymentCommit: input.deploymentCommit && /^[a-f0-9]{7,40}$/iu.test(input.deploymentCommit) ? input.deploymentCommit : null,
    search: { topic: input.topic, localQuery: input.localQuery, countryCode: input.countryCode, language: input.language, queryMethod: input.queryMethod },
    summary: {
      mode: input.summaryMode,
      passages: passages.map(([key, passage]) => ({ key, citationIds: passage.citations, supportingQuoteCount: passage.supportingQuotes?.length ?? 0 })),
    },
    sources: await Promise.all(views.map(async (view) => ({
      key: view.result.key,
      query: view.result.query,
      startedAt: view.result.asOf,
      retrievedAt: view.result.retrievedAt ?? null,
      window: view.result.window,
      status: view.result.status,
      providerReturnedCount: view.result.status === "complete" || view.result.status === "partial" ? view.returnedCount : view.result.providerReturnedCount ?? null,
      sourceSafetyExcludedCount: view.result.adapterExcludedCount ?? (view.result.status === "complete" || view.result.status === "partial" ? 0 : null),
      topicExcludedCount: view.result.topicExcludedCount ?? (view.result.status === "complete" || view.result.status === "partial" ? 0 : null),
      duplicateSuppressedCount: view.duplicateCount,
      displayedUniqueCount: view.evidence.length,
      overviewCandidateCount: input.candidateCounts[view.result.key] ?? 0,
      records: await Promise.all(view.result.evidence.map(async (item) => {
        const citationId = citations.get(citationKey(view.result.key, item.id)) ?? null;
        return {
          citationId,
          // Same original in multiple views has one per-run fingerprint. The
          // random salt stays only in memory, preventing dictionary lookup from
          // a downloaded audit alone. These remain pseudonymous, not anonymous.
          originalFingerprint: await fingerprint(normalizeSourceUrl(item.url) || item.id),
          operatorKey: item.sourceOperatorKey ?? null,
          evidenceClass: item.evidenceClass,
          language: item.language,
          publishedAt: item.timeValue,
          displayed: view.evidence.some(({ id }) => id === item.id),
          overviewSelected: citationId !== null && selected.has(citationId),
          citedBy: passages.filter(([, passage]) => citationId !== null && passage.citations.includes(citationId)).map(([key]) => key),
        };
      })),
    }))),
    limits: [
      "Queries may contain sensitive information you entered. Review before sharing.",
      "Original text, titles, source URLs, author identifiers, raw provider errors, summary wording, and supporting quotes are excluded.",
      "Record fingerprints are pseudonymous, stable within this search only, and cannot reopen an original source. Review source links in Atlas before closing this search.",
      "Overview selection records client-side inputs, not proof that a model provider processed them. Fallback citations are not AI claims.",
      "Counts and source states are observations, not reviewer labels, national samples, or evidence of researcher acceptance.",
    ],
  };
}
