import { describe, expect, it } from 'vitest';
import { hasUnclearedHackerNewsEvidence, isEligibleStackExchangeQuestion, isHackerNewsIngestionEnabled, isPublicEvidenceEligible, matchesStackExchangeTitleQuery } from './source-policy';

describe('source rights gate', () => {
  it('keeps Hacker News ingestion off unless both collection and rights are explicitly enabled', () => {
    expect(isHackerNewsIngestionEnabled({ HACKER_NEWS_ENABLED: 'true' })).toBe(false);
    expect(isHackerNewsIngestionEnabled({ HACKER_NEWS_RIGHTS_APPROVED: 'true' })).toBe(false);
    expect(isHackerNewsIngestionEnabled({ HACKER_NEWS_ENABLED: 'true', HACKER_NEWS_RIGHTS_APPROVED: 'false' })).toBe(false);
    expect(isHackerNewsIngestionEnabled({ HACKER_NEWS_ENABLED: 'true', HACKER_NEWS_RIGHTS_APPROVED: 'true' })).toBe(true);
  });

  it('detects evidence that should prevent a public lead from being shown', () => {
    expect(hasUnclearedHackerNewsEvidence(['news', 'forum'])).toBe(false);
    expect(hasUnclearedHackerNewsEvidence(['news', 'hacker-news'])).toBe(true);
    expect(hasUnclearedHackerNewsEvidence([null, undefined])).toBe(false);
  });

  it('excludes uncleared HN and Google News redirects from public evidence', () => {
    expect(isPublicEvidenceEligible('hacker-news', 'news.ycombinator.com')).toBe(false);
    expect(isPublicEvidenceEligible('rss', 'news.google.com')).toBe(false);
    expect(isPublicEvidenceEligible('rss', 'WWW.NEWS.GOOGLE.COM')).toBe(false);
    expect(isPublicEvidenceEligible('rss', 'publisher.example')).toBe(true);
  });

  it('requires every recorded Stack Exchange query term to appear as a title token', () => {
    expect(matchesStackExchangeTitleQuery('How does AI affect inflation?', 'AI')).toBe(true);
    expect(matchesStackExchangeTitleQuery('AI and interest rates', 'interest rates')).toBe(true);
    expect(matchesStackExchangeTitleQuery('Artificial intelligence', 'AI')).toBe(false);
    expect(matchesStackExchangeTitleQuery('Question title', undefined)).toBe(false);
  });

  it('preserves combining marks rather than equating distinct Devanagari words', () => {
    expect(matchesStackExchangeTitleQuery('तांबा बाजार', 'तांबा')).toBe(true);
    expect(matchesStackExchangeTitleQuery('ताबा बाजार', 'तांबा')).toBe(false);
    expect(matchesStackExchangeTitleQuery('तांबा बाजार', 'ताबा')).toBe(false);
  });

  it('matches canonical-equivalent accents without accepting a different word', () => {
    expect(matchesStackExchangeTitleQuery('Le marche\u0301 du cuivre', 'marché')).toBe(true);
    expect(matchesStackExchangeTitleQuery('Le marche du cuivre', 'marché')).toBe(false);
  });

  it('allows broad Stack Exchange feed items only when CC BY-SA title-only metadata is explicit', () => {
    const metadata = {
      collectionMethod: 'recent-licensed-question-feed',
      contentLicense: 'CC BY-SA 4.0',
      titleUnmodified: true,
      questionBodyRetained: false,
      answerBodyRetained: false,
    };
    expect(isEligibleStackExchangeQuestion('A recent question', metadata)).toBe(true);
    expect(isEligibleStackExchangeQuestion('', metadata)).toBe(false);
    expect(isEligibleStackExchangeQuestion('A recent question', { ...metadata, contentLicense: 'CC BY-NC-SA 4.0' })).toBe(false);
    expect(isEligibleStackExchangeQuestion('A recent question', { ...metadata, questionBodyRetained: true })).toBe(false);
    expect(isEligibleStackExchangeQuestion('Inflation and tariffs', { query: 'tariffs' })).toBe(true);
  });
});
