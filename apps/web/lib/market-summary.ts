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

/** Remove direct links, emails, and @handles before a short discussion excerpt is sent to the model. */
export function redactSummaryExcerpt(value: string): string {
  return value.normalize("NFKC")
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/giu, "[link]")
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, "[email]")
    .replace(/(^|[^\p{L}\p{N}_])@[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}/gu, "$1[handle]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Preserve provider return counts while flagging records repeated across query/server views. */
export function flagRepeatedEvidenceViews(results: ResearchSweepSourceResult[]): ResearchSweepSourceResult[] {
  const recordViews = new Map<string, Set<string>>();
  const textViews = new Map<string, Set<string>>();
  const crossOperatorTextViews = new Map<string, Map<string, Set<string>>>();
  const nearDuplicateItems = new Set<string>();
  const textItemsByOperator = new Map<string, Array<{ resultKey: string; itemKey: string; text: string }>>();
  for (const result of results) {
    for (const item of result.evidence) {
      const operator = item.sourceOperatorKey ?? item.source;
      const recordKey = `url\u0000${normalizeSourceUrl(item.url)}`;
      const text = (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const textKey = text ? `${operator}\u0000text\u0000${text}` : "";
      if (text) {
        if (text.length >= 80) {
          const operators = crossOperatorTextViews.get(text) ?? new Map<string, Set<string>>();
          const views = operators.get(operator) ?? new Set<string>();
          views.add(`${result.key}\u0000${item.id}`);
          operators.set(operator, views);
          crossOperatorTextViews.set(text, operators);
        }
        const rows = textItemsByOperator.get(operator) ?? [];
        rows.push({ resultKey: result.key, itemKey: `${result.key}\u0000${item.id}`, text });
        textItemsByOperator.set(operator, rows);
      }
      addView(recordViews, recordKey, result.key);
      if (textKey) addView(textViews, textKey, result.key);
    }
  }
  for (const rows of textItemsByOperator.values()) {
    for (let left = 0; left < rows.length; left++) {
      for (let right = left + 1; right < rows.length; right++) {
        if (!isNearDuplicateExcerpt(rows[left].text, rows[right].text)) continue;
        nearDuplicateItems.add(rows[left].itemKey);
        nearDuplicateItems.add(rows[right].itemKey);
      }
    }
  }
  return results.map((result) => {
    let repeated = 0;
    const evidence = result.evidence.map((item) => {
      const operator = item.sourceOperatorKey ?? item.source;
      const recordViewsForItem = recordViews.get(`url\u0000${normalizeSourceUrl(item.url)}`);
      const text = (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const textViewsForItem = textViews.get(`${operator}\u0000text\u0000${text}`);
      const crossOperatorViews = text.length >= 80 ? crossOperatorTextViews.get(text) : undefined;
      const crossOperatorDuplicate = (crossOperatorViews?.size ?? 0) > 1;
      const nearDuplicate = nearDuplicateItems.has(`${result.key}\u0000${item.id}`);
      const otherViews = Math.max(recordViewsForItem?.size ?? 0, textViewsForItem?.size ?? 0) - 1;
      if (otherViews < 1 && !nearDuplicate && !crossOperatorDuplicate) return item;
      repeated += 1;
      const reason = recordViewsForItem && recordViewsForItem.size > 1
        ? `Same source URL appears in ${recordViewsForItem.size} query/server views; repeated appearances are not independent evidence.`
        : crossOperatorDuplicate
          ? "Exact long-form text appears across multiple source operators; it may be cross-posted and is not independent corroboration."
          : textViewsForItem && textViewsForItem.size > 1
          ? `Exact normalized text appears in ${textViewsForItem.size} query/server views; repeated appearances are not independent corroboration.`
          : "Near-identical long-form text appears in another record from the same source network; treat it as a possible copy, not independent corroboration.";
      return { ...item, context: [item.context, reason].filter(Boolean).join(" ") };
    });
    const overlapNote = repeated
      ? `Possible duplication: ${repeated} of ${result.evidence.length} returned records duplicate or closely resemble other evidence; copies are not independent corroboration.`
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
  expectedLanguage?: string,
): ModelEvidence[] {
  const sources = new Map<string, Array<ModelEvidence & { dedupeKeys: string[] }>>();
  const seenText = new Set<string>();
  const seenRecords = new Set<string>();
  const seenNearDuplicateText = new Map<string, string[]>();

  for (const result of results) {
    for (const item of result.evidence) {
      if (expectedLanguage && hasExplicitLanguageMismatch(item.language, expectedLanguage)) continue;
      const excerpt = item.transientPreview ? redactSummaryExcerpt(item.transientPreview) : "";
      const citationId = citationIds.get(citationKey(result.key, item.id));
      if (!excerpt || !citationId || !/^C\d{1,4}$/.test(citationId)) continue;

      // Replicated federation copies can be linked below, but must not become
      // extra weight in an AI summary. Only exact normalized text is collapsed.
      const operator = item.sourceOperatorKey ?? item.source;
      const normalizedText = excerpt.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
      const textKey = normalizedText.length >= 80
        ? `cross-operator-text\u0000${normalizedText}`
        : `${operator}\u0000text\u0000${normalizedText}`;
      const recordKey = `url\u0000${normalizeSourceUrl(item.url)}`;
      if (seenText.has(textKey) || seenRecords.has(recordKey) || excludedKeys.has(textKey) || excludedKeys.has(recordKey)) continue;
      const nearMatches = seenNearDuplicateText.get(operator) ?? [];
      if (nearMatches.some((text) => isNearDuplicateExcerpt(normalizedText, text))) continue;
      seenText.add(textKey);
      seenRecords.add(recordKey);
      nearMatches.push(normalizedText);
      seenNearDuplicateText.set(operator, nearMatches);

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

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en", korean: "ko", japanese: "ja", german: "de",
  french: "fr", portuguese: "pt", hindi: "hi", spanish: "es",
};

/** Provider language labels may be missing or instance-local; only exclude explicit, understood mismatches. */
function hasExplicitLanguageMismatch(reported: string, expected: string): boolean {
  const canonical = (value: string) => {
    const cleaned = value.trim().toLocaleLowerCase().replaceAll("_", "-");
    const named = LANGUAGE_NAMES[cleaned];
    if (named) return named;
    if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(cleaned)) return cleaned.split("-", 1)[0];
    return null;
  };
  const actualCode = canonical(reported);
  const expectedCode = canonical(expected);
  return actualCode !== null && expectedCode !== null && actualCode !== expectedCode;
}

function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|ref|source)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

/** Conservative copy detection: long excerpts need >=90% shingle overlap (5-token or 4-character CJK). */
export function isNearDuplicateExcerpt(left: string, right: string): boolean {
  if (left.length < 120 || right.length < 120) return false;
  const shingles = (value: string) => {
    const normalized = value.normalize("NFKC").toLocaleLowerCase();
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) {
      const characters = Array.from(normalized.replace(/[^\p{L}\p{N}]/gu, ""));
      const result = new Set<string>();
      for (let index = 0; index <= characters.length - 4; index++) result.add(characters.slice(index, index + 4).join(""));
      return result;
    }
    const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
    const result = new Set<string>();
    for (let index = 0; index <= tokens.length - 5; index++) result.add(tokens.slice(index, index + 5).join(" "));
    return result;
  };
  const leftShingles = shingles(left);
  const rightShingles = shingles(right);
  const smaller = leftShingles.size <= rightShingles.size ? leftShingles : rightShingles;
  const larger = smaller === leftShingles ? rightShingles : leftShingles;
  if (smaller.size < 8) return false;
  let shared = 0;
  for (const shingle of smaller) if (larger.has(shingle)) shared++;
  return shared / smaller.size >= 0.9;
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
    : { text: "No text-bearing records were submitted for the baseline overview. Check source status below; this does not show that discussion is absent.", citations: [] };
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
