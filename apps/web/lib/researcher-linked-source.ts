import type { LeadSourceDocument } from "./research-lead-submission";
import { reviewedLinkSourceForUrl } from "./news-source-operators";

export type ResearcherLinkedCitationInput = {
  id: string;
  title: string;
  url: string;
  timeValue: string;
  language: string;
  attribution: string;
  assessment: "supports" | "contradicts" | "context";
  sourceObservation: string;
  researcherVerifiedOriginal: true;
};

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_ONLY_REPORT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STACK_EXCHANGE_LICENSE = "CC BY-SA 4.0";
const STACK_EXCHANGE_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const MASTODON_HOSTS = new Set(["mastodon.social", "mastodon.online", "mstdn.jp", "mastodon.world"]);
const LEMMY_HOSTS = new Set(["lemmy.world", "discuss.tchncs.de", "feddit.org", "feddit.uk", "jlai.lu", "sopuli.xyz", "sh.itjust.works"]);
const STACK_EXCHANGE_SITES: Record<string, { host: string; label: string }> = {
  economics: { host: "economics.stackexchange.com", label: "Economics Stack Exchange" },
  quant: { host: "quant.stackexchange.com", label: "Quantitative Finance Stack Exchange" },
  money: { host: "money.stackexchange.com", label: "Personal Finance & Money Stack Exchange" },
  ai: { host: "ai.stackexchange.com", label: "Artificial Intelligence Stack Exchange" },
  datascience: { host: "datascience.stackexchange.com", label: "Data Science Stack Exchange" },
  security: { host: "security.stackexchange.com", label: "Information Security Stack Exchange" },
  "es.stackoverflow": { host: "es.stackoverflow.com", label: "Stack Overflow en español" },
  "pt.stackoverflow": { host: "pt.stackoverflow.com", label: "Stack Overflow em Português" },
  "ja.stackoverflow": { host: "ja.stackoverflow.com", label: "スタック・オーバーフロー" },
  "ru.stackoverflow": { host: "ru.stackoverflow.com", label: "Stack Overflow на русском" },
  politics: { host: "politics.stackexchange.com", label: "Politics Stack Exchange" },
  law: { host: "law.stackexchange.com", label: "Law Stack Exchange" },
};

export type VerifiedStackExchangeQuestion = {
  site: string;
  siteLabel: string;
  title: string;
  url: string;
  publishedAt: string;
  author: string;
  authorUrl: string;
};

/**
 * Turn an explicitly published, researcher-reviewed social link or provider-
 * verified Stack Exchange question into a minimal citation row.
 */
export function prepareResearcherLinkedSource(
  citation: ResearcherLinkedCitationInput,
  id: string,
  now = Date.now(),
  verifiedQuestion?: VerifiedStackExchangeQuestion,
): LeadSourceDocument | null {
  const provider = citation.id.split(":", 1)[0];
  const url = safeCanonicalUrl(citation.url);
  const published = Date.parse(citation.timeValue);
  const isReviewedExternalLink = ["newslink", "companylink", "surveylink"].includes(provider);
  const reviewedLinkSource = url && isReviewedExternalLink
    ? reviewedLinkSourceForUrl(url.toString())
    : null;
  const attribution = isReviewedExternalLink
    ? reviewedLinkSource?.provider === provider ? `Source: ${reviewedLinkSource.label}` : ""
    : citation.attribution.trim().replace(/\s+/g, " ");
  const suppliedTitle = citation.title.trim().replace(/\s+/g, " ");
  const publicByline = attribution.replace(/^(?:Lemmy )?Author:\s*/i, "");
  const title = provider === "newslink" && reviewedLinkSource?.provider === provider
    ? `Link-only report from ${reviewedLinkSource.label}`
    : provider === "companylink" && reviewedLinkSource?.provider === provider
      ? `Link-only company disclosure from ${reviewedLinkSource.label}`
      : provider === "surveylink" && reviewedLinkSource?.provider === provider
        ? `Link-only survey report from ${reviewedLinkSource.label}`
        : provider === "stackexchange"
          ? verifiedQuestion?.title ?? ""
          : provider === "lemmy"
            ? `Public Lemmy post by ${publicByline}`
            : `Public post by ${publicByline}`;
  const observation = citation.sourceObservation.trim().replace(/\s+/g, " ");
  const maxAge = isReviewedExternalLink
    ? LINK_ONLY_REPORT_MAX_AGE_MS
    : MAX_AGE_MS;

  if (!url || !isProviderPermalink(provider, url) || !isUuid(id) ||
      (isReviewedExternalLink && citation.id !== `${provider}:${url.toString()}`) ||
      !Number.isFinite(published) || published > now || now - published > maxAge ||
      title.length < 3 || title.length > 300 || suppliedTitle.length > 500 || attribution.length < 2 || attribution.length > 250 ||
      citation.language.trim().length > 60 || observation.length < 20 || observation.length > 1000 ||
      citation.researcherVerifiedOriginal !== true ||
      !["supports", "contradicts", "context"].includes(citation.assessment)) return null;

  if (provider === "stackexchange" && (!verifiedQuestion || verifiedQuestion.url !== url.toString() ||
      verifiedQuestion.title !== citation.title.trim() || verifiedQuestion.author !== attribution.replace(/^Author:\s*/i, "") ||
      Date.parse(verifiedQuestion.publishedAt) !== published ||
      verifiedQuestion.siteLabel !== STACK_EXCHANGE_SITES[verifiedQuestion.site]?.label ||
      new URL(verifiedQuestion.url).hostname !== STACK_EXCHANGE_SITES[verifiedQuestion.site]?.host)) return null;

  const sourceName = isReviewedExternalLink && reviewedLinkSource?.provider === provider ? reviewedLinkSource.label
    : provider === "bluesky" ? "Bluesky public post"
    : provider === "mastodon" ? `Mastodon · ${url.hostname}`
      : provider === "lemmy" ? `Lemmy · ${url.hostname}`
        : provider === "stackexchange" ? verifiedQuestion!.siteLabel : null;
  if (!sourceName) return null;

  return {
    id,
    market_code: "INTL",
    source_type: "researcher-linked-source",
    source_name: sourceName,
    source_domain: url.hostname,
    language_code: citation.language.trim().slice(0, 60) || null,
    title_original: title,
    source_url: url.toString(),
    published_at: new Date(published).toISOString(),
    raw_metadata_json: {
      citationProvider: provider,
      attribution,
      ...(provider === "stackexchange" && verifiedQuestion ? {
        attributionUrl: verifiedQuestion.authorUrl,
        site: verifiedQuestion.site,
        contentLicense: STACK_EXCHANGE_LICENSE,
        licenseUrl: STACK_EXCHANGE_LICENSE_URL,
        titleUnmodified: true,
      } : {}),
      ...(reviewedLinkSource && isReviewedExternalLink ? {
        reviewedPublisherKey: reviewedLinkSource.key,
        reviewedPublisherLabel: reviewedLinkSource.label,
      } : {}),
      researcherLinkedOnly: true,
      postBodyDiscarded: true,
      transientPreviewDiscarded: true,
      rightsBasis: provider === "stackexchange"
        ? "provider-verified CC BY-SA 4.0 title and attribution; question body discarded"
        : isReviewedExternalLink
          ? "researcher-verified canonical source link and researcher-authored note only; headline, report text, and byline not retained"
        : "public permalink and researcher-authored citation only",
    },
  };
}

/** Recheck up to four live questions in one keyless official-API call per site. */
export async function verifyStackExchangeCitations(
  citations: ResearcherLinkedCitationInput[],
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Map<string, VerifiedStackExchangeQuestion> | null> {
  const selected = citations.filter(({ id }) => id.startsWith("stackexchange:"));
  if (!selected.length) return new Map();
  const groups = new Map<string, Array<{ citation: ResearcherLinkedCitationInput; questionId: string }>>();
  for (const citation of selected) {
    const url = safeCanonicalUrl(citation.url);
    const match = url?.pathname.match(/^\/questions\/(\d+)\/[^/]+\/?$/);
    const site = url ? stackExchangeSiteForHost(url.hostname) : null;
    if (!url || !site || !match || citation.id !== `stackexchange:${citation.url}`) return null;
    const group = groups.get(site) ?? [];
    if (group.some(({ questionId }) => questionId === match[1])) return null;
    group.push({ citation, questionId: match[1] });
    groups.set(site, group);
  }
  if (groups.size > 4) return null;

  const verified = new Map<string, VerifiedStackExchangeQuestion>();
  for (const [site, group] of groups) {
    const params = new URLSearchParams({ site, filter: "default" });
    const endpoint = `https://api.stackexchange.com/2.3/questions/${group.map(({ questionId }) => questionId).join(";")}?${params}`;
    let response: Response;
    let body: StackExchangeQuestionResponse;
    try {
      response = await fetcher(endpoint, { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      body = await response.json() as StackExchangeQuestionResponse;
    } catch {
      return null;
    }
    if (body.backoff || body.error_id || !Array.isArray(body.items)) return null;
    const byId = new Map((body.items ?? []).map((question) => [String(question.question_id), question]));
    const siteInfo = STACK_EXCHANGE_SITES[site];
    for (const { citation, questionId } of group) {
      const question = byId.get(questionId);
      const url = question?.link ? safeCanonicalUrl(question.link) : null;
      const createdAt = question?.creation_date ? question.creation_date * 1000 : NaN;
      const author = question?.owner?.display_name?.trim();
      const authorUrl = question?.owner?.link ? safeCanonicalUrl(question.owner.link) : null;
      const title = safeDecodeStackExchangeTitle(question?.title ?? "");
      if (!question || question.content_license !== STACK_EXCHANGE_LICENSE || !url || !author || !authorUrl || !title ||
          authorUrl.hostname !== siteInfo.host || !/^\/users\/\d+(?:\/[^/]+)?\/?$/.test(authorUrl.pathname) ||
          url.hostname !== siteInfo.host || url.toString() !== citation.url ||
          title !== citation.title.trim() ||
          `Author: ${author}` !== citation.attribution.trim() ||
          !Number.isFinite(createdAt) || createdAt > now || now - createdAt > MAX_AGE_MS ||
          Date.parse(citation.timeValue) !== createdAt) return null;
      verified.set(citation.url, {
        site,
        siteLabel: siteInfo.label,
        title,
        url: url.toString(),
        publishedAt: new Date(createdAt).toISOString(),
        author,
        authorUrl: authorUrl.toString(),
      });
    }
  }
  return verified.size === selected.length ? verified : null;
}

/** Client-side publish affordance helper; the server repeats all checks before storage. */
export function isPublishableResearcherLinkedCitation(item: { id: string; url: string; timeValue: string }): boolean {
  const provider = item.id.split(":", 1)[0];
  const url = safeCanonicalUrl(item.url);
  const published = Date.parse(item.timeValue);
  const maxAge = ["newslink", "companylink", "surveylink"].includes(provider)
    ? LINK_ONLY_REPORT_MAX_AGE_MS
    : MAX_AGE_MS;
  return Boolean(url && isProviderPermalink(provider, url) && Number.isFinite(published) &&
    published <= Date.now() && Date.now() - published <= maxAge);
}

function isProviderPermalink(provider: string, url: URL) {
  if (provider === "bluesky")
    return url.hostname === "bsky.app" && /^\/profile\/[^/]+\/post\/[^/]+\/?$/.test(url.pathname);
  if (provider === "mastodon")
    return MASTODON_HOSTS.has(url.hostname) && /^\/(?:@[^/]+\/\d+|web\/statuses\/\d+)\/?$/.test(url.pathname);
  if (provider === "lemmy")
    return LEMMY_HOSTS.has(url.hostname) && /^\/post\/\d+\/?$/.test(url.pathname);
  if (provider === "stackexchange")
    return Boolean(stackExchangeSiteForHost(url.hostname) && /^\/questions\/\d+\/[^/]+\/?$/.test(url.pathname));
  if (provider === "newslink" || provider === "companylink" || provider === "surveylink") {
    const source = reviewedLinkSourceForUrl(url.toString());
    return Boolean(source?.provider === provider && url.pathname.length > 1 && !url.search && !url.hash);
  }
  return false;
}

function stackExchangeSiteForHost(host: string) {
  return Object.entries(STACK_EXCHANGE_SITES).find(([, site]) => site.host === host)?.[0] ?? null;
}

export function isReviewedStackExchangeSiteHost(host: string, site: string) {
  return STACK_EXCHANGE_SITES[site]?.host === host;
}

type StackExchangeQuestionResponse = {
  items?: Array<{
    question_id?: number;
    title?: string;
    link?: string;
    creation_date?: number;
    content_license?: string;
    owner?: { display_name?: string; link?: string };
  }>;
  backoff?: number;
  error_id?: number;
};

function safeDecodeStackExchangeTitle(value: string) {
  try {
    return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  } catch {
    return null;
  }
}

function safeCanonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
