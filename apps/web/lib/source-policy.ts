export const HACKER_NEWS_SOURCE_TYPE = 'hacker-news';

export function isHackerNewsIngestionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HACKER_NEWS_ENABLED === 'true' && env.HACKER_NEWS_RIGHTS_APPROVED === 'true';
}

export function hasUnclearedHackerNewsEvidence(
  sourceTypes: Array<string | null | undefined>,
): boolean {
  return sourceTypes.includes(HACKER_NEWS_SOURCE_TYPE);
}

/** Sources withheld from public research must not enter public-facing evidence aggregates. */
export function isPublicEvidenceEligible(sourceType: string | null | undefined, sourceDomain: string | null | undefined): boolean {
  if (sourceType === HACKER_NEWS_SOURCE_TYPE) return false;
  const domain = sourceDomain?.trim().toLocaleLowerCase().replace(/^www\./, '');
  if (domain === 'news.google.com') return false;
  return true;
}

/** Hide legacy Stack Exchange rows whose pre-fix API query did not constrain titles. */
export function matchesStackExchangeTitleQuery(title: string | null | undefined, query: unknown): boolean {
  if (!title || typeof query !== "string") return false;
  const tokens = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  const expected = tokens(query);
  if (!expected.length) return false;
  const titleTokens = new Set(tokens(title));
  return expected.every((token) => titleTokens.has(token));
}

/** Eligibility for either legacy title-query records or the bounded licensed recent-question feed. */
export function isEligibleStackExchangeQuestion(
  title: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (metadata?.collectionMethod === 'recent-licensed-question-feed') {
    return metadata.contentLicense === 'CC BY-SA 4.0' &&
      metadata.titleUnmodified === true &&
      metadata.questionBodyRetained === false && metadata.answerBodyRetained === false &&
      Boolean(title?.trim());
  }
  return matchesStackExchangeTitleQuery(title, metadata?.query);
}
