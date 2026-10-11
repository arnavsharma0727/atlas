import { citationKey } from "./perspective-snapshot";
import type { ResearchSweepSourceResult } from "./research-sweep";

export type SummaryPassage = { text: string; citations: string[] };
export type MarketSummary = {
  usSummary: SummaryPassage;
  localSummary: SummaryPassage;
  comparison: SummaryPassage;
  limitations: string[];
};

export type ModelEvidence = {
  citationId: string;
  source: string;
  title: string;
  excerpt: string;
  language: string;
};

/** Preserve provider return counts while flagging records repeated across query/server views. */
export function flagRepeatedEvidenceViews(results: ResearchSweepSourceResult[]): ResearchSweepSourceResult[] {
  const recordViews = new Map<string, Set<string>>();
  const textViews = new Map<string, Set<string>>();
  for (const result of results) {
    for (const item of result.evidence) {
      const operator = item.sourceOperatorKey ?? item.source;
      const recordKey = `${operator}\u0000url\u0000${item.url}`;
      const text = (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const textKey = text ? `${operator}\u0000text\u0000${text}` : "";
      addView(recordViews, recordKey, result.key);
      if (textKey) addView(textViews, textKey, result.key);
    }
  }
  return results.map((result) => {
    let repeated = 0;
    const evidence = result.evidence.map((item) => {
      const operator = item.sourceOperatorKey ?? item.source;
      const recordViewsForItem = recordViews.get(`${operator}\u0000url\u0000${item.url}`);
      const text = (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const textViewsForItem = textViews.get(`${operator}\u0000text\u0000${text}`);
      const otherViews = Math.max(recordViewsForItem?.size ?? 0, textViewsForItem?.size ?? 0) - 1;
      if (otherViews < 1) return item;
      repeated += 1;
      const reason = recordViewsForItem && recordViewsForItem.size > 1
        ? `Same source URL appears in ${recordViewsForItem.size} query/server views; repeated appearances are not independent evidence.`
        : `Exact normalized text appears in ${textViewsForItem?.size ?? 0} query/server views; repeated appearances are not independent corroboration.`;
      return { ...item, context: [item.context, reason].filter(Boolean).join(" ") };
    });
    const overlapNote = repeated
      ? `Overlap: ${repeated} of ${result.evidence.length} returned records also appear in another query/server view; repeated appearances are not independent evidence.`
      : undefined;
    return {
      ...result,
      evidence,
      ...(overlapNote ? { sourceNote: [result.sourceNote, overlapNote].filter(Boolean).join(" ") } : {}),
    };
  });
}

function addView(map: Map<string, Set<string>>, key: string, resultKey: string) {
  const views = map.get(key) ?? new Set<string>();
  views.add(resultKey);
  map.set(key, views);
}

/** Select a small, source-balanced set of transient excerpts with resolvable citations. */
export function selectBalancedEvidence(
  results: ResearchSweepSourceResult[],
  citationIds: Map<string, string>,
  limit = 8,
  excludedKeys = new Set<string>(),
): ModelEvidence[] {
  const sources = new Map<string, Array<ModelEvidence & { dedupeKeys: string[] }>>();
  const seenText = new Set<string>();
  const seenRecords = new Set<string>();

  for (const result of results) {
    for (const item of result.evidence) {
      const excerpt = item.transientPreview?.replace(/(^|\s)@[\p{L}\p{N}_.-]{2,}/gu, "$1[handle]").trim().slice(0, 300);
      const citationId = citationIds.get(citationKey(result.key, item.id));
      if (!excerpt || !citationId || !/^C\d{1,4}$/.test(citationId)) continue;

      // Replicated federation copies can be linked below, but must not become
      // extra weight in an AI summary. Only exact normalized text is collapsed.
      const operator = item.sourceOperatorKey ?? item.source;
      const normalizedText = excerpt.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
      const textKey = `${operator}\u0000text\u0000${normalizedText}`;
      const recordKey = `${operator}\u0000url\u0000${item.url}`;
      if (seenText.has(textKey) || seenRecords.has(recordKey) || excludedKeys.has(textKey) || excludedKeys.has(recordKey)) continue;
      seenText.add(textKey);
      seenRecords.add(recordKey);

      const group = sources.get(operator) ?? [];
      group.push({
        citationId,
        source: item.source.slice(0, 80),
        title: item.evidenceClass === "social discussion" ? "Public discussion post" : item.title.slice(0, 180),
        excerpt,
        language: item.language.slice(0, 24),
        dedupeKeys: [textKey, recordKey],
      });
      sources.set(operator, group);
    }
  }

  const selected: Array<ModelEvidence & { dedupeKeys: string[] }> = [];
  const buckets = [...sources.values()];
  while (selected.length < limit) {
    let added = false;
    for (const bucket of buckets) {
      const item = bucket.shift();
      if (!item) continue;
      selected.push(item);
      item.dedupeKeys.forEach((key) => excludedKeys.add(key));
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected.map(({ dedupeKeys: _dedupeKeys, ...item }) => item);
}

/** Validate model-returned citations against the exact evidence sent in that request. */
export function normalizeMarketSummary(
  value: unknown,
  available: { us: Set<string>; local: Set<string> },
): MarketSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const passage = (key: string, citationsKey: string, allowed: Set<string>, mustCite: boolean): SummaryPassage | null => {
    const text = typeof record[key] === "string" ? record[key].trim().slice(0, 900) : "";
    if (!text || /https?:\/\/|\[\s*C\d{1,4}\s*\]/i.test(text)) return null;
    const citations = Array.isArray(record[citationsKey])
      ? [...new Set((record[citationsKey] as unknown[]).filter((id): id is string => typeof id === "string" && allowed.has(id)))].slice(0, 8)
      : [];
    if (mustCite && !citations.length) return null;
    return { text, citations };
  };

  const submittedIds = new Set([...available.us, ...available.local]);
  const usSummary = available.us.size
    ? passage("usSummary", "usCitations", available.us, true)
    : { text: "No text-bearing records were submitted for this English-language overview. Check source status below; this does not show that discussion is absent.", citations: [] };
  const localSummary = available.local.size
    ? passage("localSummary", "localCitations", available.local, true)
    : { text: "No text-bearing records were submitted for this selected language/community overview. Check source status below; this does not show that discussion is absent.", citations: [] };
  const comparison = available.us.size && available.local.size
    ? passage("comparison", "comparisonCitations", submittedIds, true)
    : { text: "A comparison is not available because one or both sides returned no text-bearing records. The available source results are not a like-for-like sample.", citations: [...submittedIds].slice(0, 4) };
  if (!usSummary || !localSummary || !comparison) return null;

  const limitations = Array.isArray(record.limitations)
    ? record.limitations.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 4).map((entry) => entry.trim().slice(0, 220))
    : [];
  return { usSummary, localSummary, comparison, limitations };
}
