import type { ResearchEvidence } from "./research-brief";
import { isReviewedStackExchangeSiteHost } from "./researcher-linked-source";
import { isEligibleStackExchangeQuestion } from "./source-policy";
import { reviewedLinkSourceForUrl } from "./news-source-operators";

type StoredPublisherRow = {
  id: string;
  source_type: string;
  source_name: string;
  source_domain: string;
  language_code: string | null;
  title_original: string;
  source_url: string;
  published_at: string;
  raw_metadata_json: Record<string, unknown> | null;
};

const GV_LICENSE = "https://creativecommons.org/licenses/by/3.0/";
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";
const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const OPERATOR_LABELS: Record<string, string> = {
  "global-voices": "Global Voices",
  "the-conversation": "The Conversation",
  "typst-forum": "Typst Forum",
  "fedora-discussion": "Fedora Discussion",
  "stack-exchange": "Stack Exchange",
  bluesky: "Bluesky",
  "mastodon-network": "Mastodon public instances",
  "lemmy-federation": "Lemmy federated search",
  "abc-news-australia": "ABC News Australia",
  smartcompany: "SmartCompany",
  firmus: "Firmus",
  verasight: "Verasight",
};

/** Convert only recent, allowlisted publisher records or researcher-published link-only citations to public evidence. */
export function toPublisherEvidence(
  row: StoredPublisherRow,
  now = Date.now(),
): ResearchEvidence | null {
  const url = safeHttpsUrl(row.source_url);
  const host = url?.hostname.toLowerCase();
  const published = Date.parse(row.published_at);
  const linkProvider = typeof row.raw_metadata_json?.citationProvider === "string"
    ? row.raw_metadata_json.citationProvider
    : "";
  const maxAge = row.source_type === "researcher-linked-source" && ["newslink", "companylink", "surveylink"].includes(linkProvider)
    ? 30 * 24 * 60 * 60_000
    : row.source_type === "researcher-linked-source"
      ? 7 * 24 * 60 * 60_000
    : 72 * 60 * 60_000;
  if (!url || !host || !row.id || !row.title_original?.trim() ||
      !Number.isFinite(published) || published > now + 5 * 60_000 || now - published > maxAge) return null;

  const meta = row.raw_metadata_json;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  let evidenceClass: ResearchEvidence["evidenceClass"];
  let attribution: string;
  let licenseName: string | undefined;
  let licenseUrl: string | undefined;
  let attributionUrl: string | undefined;
  let sourceOperatorKey: string;
  let context: string;

  if (row.source_type === "researcher-linked-source" && row.source_domain === host &&
      meta.researcherLinkedOnly === true && meta.postBodyDiscarded === true &&
      meta.transientPreviewDiscarded === true &&
      typeof meta.attribution === "string" && meta.attribution.trim()) {
    attribution = meta.attribution.trim().slice(0, 250);
    if (meta.citationProvider === "stackexchange" &&
        meta.contentLicense === "CC BY-SA 4.0" &&
        meta.licenseUrl === CC_BY_SA_4 && meta.titleUnmodified === true &&
        meta.postBodyDiscarded === true && typeof meta.site === "string" &&
        isReviewedStackExchangeSiteHost(host, meta.site) &&
        /^\/questions\/\d+\/[^/]+\/?$/.test(url.pathname) &&
        typeof meta.attributionUrl === "string" && isStackExchangeAuthorUrl(meta.attributionUrl, host)) {
      evidenceClass = "expert Q&A";
      attribution = `Author: ${attribution.replace(/^Author:\s*/i, "")}`;
      attributionUrl = meta.attributionUrl;
      licenseName = "CC BY-SA 4.0";
      licenseUrl = CC_BY_SA_4;
      sourceOperatorKey = "stack-exchange";
      context = "Provider-verified question title only; question body is not retained";
    } else if ((meta.citationProvider === "newslink" || meta.citationProvider === "companylink" || meta.citationProvider === "surveylink") &&
        row.source_domain === host && url.search === "" && url.hash === "" && url.pathname.length > 1) {
      const source = reviewedLinkSourceForUrl(url.toString());
      if (!source || source.provider !== meta.citationProvider ||
          meta.reviewedPublisherKey !== source.key || meta.reviewedPublisherLabel !== source.label ||
          attribution !== `Source: ${source.label}` ||
          row.title_original !== (meta.citationProvider === "newslink"
            ? `Link-only report from ${source.label}`
            : meta.citationProvider === "companylink"
              ? `Link-only company disclosure from ${source.label}`
              : `Link-only survey report from ${source.label}`)) return null;
      evidenceClass = meta.citationProvider === "newslink" ? "news coverage"
        : meta.citationProvider === "companylink" ? "official company disclosure" : "survey research";
      sourceOperatorKey = source.key;
      attribution = `Source: ${source.label}`;
      context = meta.citationProvider === "newslink"
        ? "Researcher-verified first-party report link; headline, article text, and byline are not retained"
        : meta.citationProvider === "companylink"
          ? "Researcher-verified issuer disclosure link; company claims are not independent verification"
          : "Researcher-verified survey report link; headline, report content, and byline are not retained";
    } else if (meta.citationProvider === "bluesky" && host === "bsky.app" &&
        meta.researcherLinkedOnly === true && meta.postBodyDiscarded === true &&
        meta.transientPreviewDiscarded === true &&
        /^\/profile\/[^/]+\/post\/[^/]+\/?$/.test(url.pathname)) {
      evidenceClass = "social discussion";
      sourceOperatorKey = "bluesky";
      context = "Researcher-selected public permalink; no post text retained or republished";
    } else if (meta.citationProvider === "mastodon" &&
        meta.researcherLinkedOnly === true && meta.postBodyDiscarded === true &&
        meta.transientPreviewDiscarded === true &&
        ["mastodon.social", "mastodon.online", "mstdn.jp", "mastodon.world"].includes(host) &&
        /^\/(?:@[^/]+\/\d+|web\/statuses\/\d+)\/?$/.test(url.pathname)) {
      evidenceClass = "social discussion";
      sourceOperatorKey = "mastodon-network";
      context = "Researcher-selected public permalink; no post text retained or republished";
    } else if (meta.citationProvider === "lemmy" &&
        meta.researcherLinkedOnly === true && meta.postBodyDiscarded === true &&
        meta.transientPreviewDiscarded === true &&
        ["lemmy.world", "discuss.tchncs.de", "feddit.org", "feddit.uk", "jlai.lu", "sopuli.xyz", "sh.itjust.works"].includes(host) &&
        /^\/post\/\d+\/?$/.test(url.pathname)) {
      evidenceClass = "social discussion";
      sourceOperatorKey = "lemmy-federation";
      context = "Researcher-selected public permalink; no post text retained or republished";
    } else {
      return null;
    }
  } else if (row.source_type === "licensed-reporting" && row.source_domain === host &&
      isGlobalVoicesHost(host) && meta.publisher === "Global Voices" &&
      meta.licenseUrl === GV_LICENSE && meta.titleUnmodified === true &&
      meta.articleBodyDiscarded === true && meta.mediaDiscarded === true &&
      typeof meta.author === "string" && meta.author.trim()) {
    evidenceClass = "news coverage";
    attribution = meta.author.trim().slice(0, 200);
    licenseName = "CC BY 3.0";
    licenseUrl = GV_LICENSE;
    sourceOperatorKey = "global-voices";
    context = typeof meta.editionLabel === "string" ? `${meta.editionLabel} edition` : "International edition";
  } else if (row.source_type === "licensed-analysis" && host === "theconversation.com" &&
      meta.publisher === "The Conversation" && meta.attributionRequired === true &&
      meta.derivativesAllowed === false && meta.contentPolicy === "unmodified-title-author-link-date-only" &&
      meta.summaryDiscarded === true && meta.articleBodyDiscarded === true &&
      typeof meta.rightsStatement === "string" && hasAttributionNoDerivativesRights(meta.rightsStatement) &&
      Array.isArray(meta.authors) && meta.authors.length > 0 && meta.authors.every(author => typeof author === "string")) {
    evidenceClass = "expert analysis";
    attribution = (meta.authors as string[]).slice(0, 8).map(author => author.slice(0, 120)).join(", ");
    sourceOperatorKey = "the-conversation";
    context = typeof meta.edition === "string" ? `${meta.edition} edition` : "Edition not recorded";
  } else if (row.source_type === "licensed-forum" && host === "forum.typst.app" &&
      row.source_domain === host && meta.publisher === "Typst Forum" &&
      meta.licenseUrl === CC_BY_4 && meta.titleUnmodified === true &&
      meta.postBodyAndSummaryDiscarded === true && typeof meta.author === "string" && meta.author.trim()) {
    evidenceClass = "community forum";
    attribution = meta.author.trim().slice(0, 120);
    licenseName = "CC BY 4.0";
    licenseUrl = CC_BY_4;
    sourceOperatorKey = "typst-forum";
    context = "Narrow software community; not market sentiment";
  } else if (row.source_type === "licensed-forum" && host === "discussion.fedoraproject.org" &&
      row.source_domain === host && meta.publisher === "Fedora Discussion" &&
      meta.licenseUrl === CC_BY_SA_4 && meta.titleUnmodified === true &&
      meta.topicBodyAndRepliesDiscarded === true && meta.profileDetailsDiscarded === true &&
      typeof meta.author === "string" && meta.author.trim()) {
    evidenceClass = "community forum";
    attribution = meta.author.trim().slice(0, 120);
    licenseName = "CC BY-SA 4.0";
    licenseUrl = CC_BY_SA_4;
    sourceOperatorKey = "fedora-discussion";
    context = "Selected Fedora/Linux community; not a population or investor sample";
  } else if (row.source_type === "stack-exchange" && isStackExchangeHost(host) &&
      row.source_domain === host && meta.contentLicense === "CC BY-SA 4.0" &&
      meta.licenseUrl === CC_BY_SA_4 && typeof meta.attributionName === "string" &&
      (meta.collectionMethod !== "recent-licensed-question-feed" ||
        (typeof meta.site === "string" && isReviewedStackExchangeSiteHost(host, meta.site) && meta.titleUnmodified === true)) &&
      meta.attributionName.trim() && isEligibleStackExchangeQuestion(row.title_original, meta)) {
    evidenceClass = "expert Q&A";
    attribution = `Author: ${meta.attributionName.trim().slice(0, 120)}`;
    licenseName = "CC BY-SA 4.0";
    licenseUrl = CC_BY_SA_4;
    sourceOperatorKey = "stack-exchange";
    context = meta.collectionMethod === "recent-licensed-question-feed"
      ? "Recent question sampled from this specialist community; title and attribution only under CC BY-SA 4.0, not a general public-opinion sample"
      : "Licensed title-only Stack Exchange question; specialist Q&A, not general public opinion";
  } else {
    return null;
  }

  return {
    id: `publisher:${row.id}`,
    title: row.title_original.trim().slice(0, 500),
    url: url.toString(),
    source: row.source_name,
    evidenceClass,
    language: row.language_code || "unassigned",
    timeLabel: "Published",
    timeValue: new Date(published).toISOString(),
    context,
    attribution,
    attributionUrl: attributionUrl ?? (sourceOperatorKey === "global-voices"
      ? "https://globalvoices.org/about/global-voices-attribution-policy/"
      : undefined),
    licenseName,
    licenseUrl,
    sourceOperatorKey,
    sourceOperatorLabel: OPERATOR_LABELS[sourceOperatorKey],
  };
}

function isStackExchangeHost(host: string) {
  return host === "stackexchange.com" || host.endsWith(".stackexchange.com") ||
    host === "stackoverflow.com" || host.endsWith(".stackoverflow.com") ||
    ["serverfault.com", "superuser.com", "askubuntu.com", "mathoverflow.net"].includes(host);
}

function isStackExchangeAuthorUrl(value: string, host: string) {
  const url = safeHttpsUrl(value);
  return Boolean(url && url.hostname === host && /^\/users\/\d+(?:\/[^/]+)?\/?$/.test(url.pathname));
}

/** Exact phrase filter for original headlines only; intentionally does not translate or infer related topics. */
export function matchesOriginalTitlePhrase(title: string, rawPhrase: string) {
  const phrase = rawPhrase.trim().normalize("NFC").toLowerCase().replace(/\s+/g, " ");
  const normalizedTitle = title.normalize("NFC").toLowerCase();
  if (!phrase) return true;
  // CJK text usually has no whitespace between words, so use a literal substring there.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(phrase))
    return normalizedTitle.includes(phrase);
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u").test(normalizedTitle);
}

/** Parse researcher-supplied phrase variants without translation or semantic expansion. */
export function parseOriginalTitlePhrases(rawPhrases: string): string[] {
  return [...new Set(rawPhrases
    .split(/[\n;]+/)
    .map(phrase => phrase.trim().normalize("NFC").replace(/\s+/g, " "))
    .filter(Boolean))];
}

export function matchingOriginalTitlePhrases(title: string, rawPhrases: string): string[] {
  return parseOriginalTitlePhrases(rawPhrases)
    .filter(phrase => matchesOriginalTitlePhrase(title, phrase));
}

/** Recent items are only surfaced when the visitor has supplied a concrete query. */
export function matchingPublisherEvidence<T extends { title: string }>(items: T[], phrase: string): T[] {
  if (!parseOriginalTitlePhrases(phrase).length) return [];
  return items.filter(item => matchingOriginalTitlePhrases(item.title, phrase).length > 0);
}

function safeHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function isGlobalVoicesHost(host: string) {
  return host === "globalvoices.org" || host.endsWith(".globalvoices.org");
}

function hasAttributionNoDerivativesRights(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes("creative commons") && normalized.includes("attribution") && normalized.includes("no derivatives");
}
