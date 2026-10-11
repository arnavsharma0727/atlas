/** Build a tiny, bounded set of Mastodon tags when AI translation/tagging is unavailable. */
export function topicHashtags(topic: string): string[] {
  const stopWords = new Set(["and", "or", "the", "for", "with", "to", "in", "of", "by"]);
  const genericMarketTags = new Set([
    "business", "chain", "company", "companies", "demand", "economic", "economy", "earnings", "finance", "financial",
    "industry", "interest", "investor", "investors", "market", "markets", "news", "price", "prices", "rate", "rates",
    "revenue", "sector", "share", "shares", "stock", "stocks", "supply", "update",
  ]);
  const normalizedTopic = topic.replace(/\bS\s*&\s*P\s*500\b/giu, "SP500");
  const parts = normalizedTopic.trim().split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((part) => /^[\p{L}\p{N}_-]{1,50}$/u.test(part));
  const candidates = parts.length > 1
    ? parts.filter((part) => !stopWords.has(part.toLocaleLowerCase()) && (Array.from(part).length > 1 || /^\p{N}+$/u.test(part)))
    : parts.length ? [parts.join("")] : [];
  const specific = candidates.filter((part) => !genericMarketTags.has(part.toLocaleLowerCase()));
  const selected = specific.length ? specific : candidates;
  const unique = [...new Set(selected.map((part) => part.normalize("NFKC").toLocaleLowerCase()))];
  return unique.slice(0, 3).map((part) => {
    const original = selected.find((candidate) => candidate.normalize("NFKC").toLocaleLowerCase() === part)!;
    return original === original.toLocaleUpperCase()
      ? original
      : original.charAt(0).toLocaleUpperCase() + original.slice(1);
  });
}
