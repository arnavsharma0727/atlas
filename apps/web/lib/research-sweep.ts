import { searchBlueskyPosts } from "./bluesky-public";
import { withFetchTimeout } from "./fetch-with-timeout";
import type { GlobalVoicesEditionResult } from "./global-voices-search";
import { DISCUSSION_COMMUNITIES, getStackExchangeThrottleStatus, searchLiveDiscussion } from "./live-topic-search";
import { LEMMY_INSTANCES, LemmyInstance, LemmyListingType, searchLemmyPosts } from "./lemmy-public";
import { MASTODON_INSTANCES, mastodonHtmlToTransientText, searchPublicHashtag } from "./mastodon-public";
import type { MastodonInstance } from "./mastodon-public";
import { WIKIMEDIA_TALK_WIKIS, searchWikimediaTalk } from "./wikimedia-talk";
import type { TheConversationSearchEdition } from "./the-conversation-search";
import type { ResearchEvidence } from "./research-brief";
import type { CrossrefWork } from "./crossref-search";
import type { ArxivRecord } from "./arxiv-search";
import { searchManifoldForecasts } from "./manifold-search";
import type { OpenAlexWork } from "./openalex-search";

export type ResearchSweepSelection = {
  /** Kept for backwards-compatible callers; GDELT is retired from live search. */
  gdelt?: boolean;
  globalVoices?: boolean;
  /** Visitor-triggered, headline-only international expert analysis; excluded from the discussion synthesis. */
  theConversation?: boolean;
  /** Visitor-triggered, title/DOI-only global scholarly metadata; never a country or discussion sample. */
  crossref?: boolean;
  /** Visitor-triggered, title-only global scholarly metadata; never a country or discussion sample. */
  openAlex?: boolean;
  /** Visitor-triggered, title/ID-only arXiv metadata; never a country or discussion sample. */
  arxiv?: boolean;
  /** Visitor-triggered play-money prediction markets; never fed into country/community summaries. */
  manifoldForecasts?: boolean;
  /** Explicit user-supplied alternatives are searched separately, never silently expanded. */
  additionalQueries?: readonly string[];
  stackExchangeSite?: string;
  stackExchangeQueries?: readonly { site: string; query: string }[];
  lemmy: boolean;
  lemmyInstances?: readonly LemmyInstance[];
  /** Locally hosted communities on these instances; distinct from their federated search. */
  lemmyLocalInstances?: readonly LemmyInstance[];
  /** Visitor-supplied local-language query for each selected instance; never translated or pooled. */
  lemmyQueries?: readonly { host: LemmyInstance; query: string }[];
  /** Deprecated compatibility field; no extra provider-terms affirmation is required. */
  lemmyTermsAccepted?: boolean;
  mastodon?: { hashtag: string; instance: string };
  /** Per-instance hashtag searches; instances remain independently labeled and bounded. */
  mastodonQueries?: readonly { hashtag: string; instance: string }[];
  /** Country/language-focused communities; their membership is not verified by poster location. */
  mastodonLocalInstances?: readonly MastodonInstance[];
  /** Deprecated compatibility field; no extra provider-terms affirmation is required. */
  mastodonTermsAccepted?: boolean;
  bluesky?: boolean;
  /** Visitor-supplied language variants stay separate; no translation or pooling. */
  blueskyQueries?: readonly string[];
  wikimediaLanguage?: string;
};

export type ResearchSweepSourceResult = {
  key: string;
  label: string;
  query: string;
  asOf: string;
  retrievedAt?: string;
  window: string;
  evidence: ResearchEvidence[];
  error: string | null;
  coverageNote?: string;
  sourceNote?: string;
  status: "complete" | "partial" | "unavailable" | "not-searched";
};

const STACK_EXCHANGE_REPEAT_WINDOW_MS = 65_000;
const STACK_EXCHANGE_CACHE_LIMIT = 200;
const LINKED_POST_CAVEAT = "This post includes an external link; its text may quote or preview linked material and does not establish the author's independent view.";
const stackExchangeRecentSearches = new Map<string, {
  expiresAt: number;
  result: Promise<ResearchEvidence[]>;
}>();

/**
 * Run bounded, visitor-triggered searches directly from the browser.
 * Provider counts/windows remain separate; this never scores or stores results.
 */
export async function runResearchSweep(
  input: string,
  selection: ResearchSweepSelection,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ResearchSweepSourceResult[]> {
  const query = input.trim();
  const asOf = new Date(now).toISOString();
  const boundedFetch = withFetchTimeout(fetcher, 8_000);
  const additionalQueries = selection.additionalQueries ?? [];
  if (additionalQueries.length > 3 || additionalQueries.some((term) => term.trim().length < 2 || term.trim().length > 100)) {
    throw new Error("Add no more than three alternate phrases, each 2–100 characters.");
  }
  const queryKeys = [query, ...additionalQueries.map((term) => term.trim())]
    .map((term) => term.normalize("NFKC").toLocaleLowerCase());
  if (new Set(queryKeys).size !== queryKeys.length) throw new Error("Each alternate phrase must be different from the main query and other alternatives.");
  const stackExchangeQueries = selection.stackExchangeQueries ?? (selection.stackExchangeSite
    ? [{ site: selection.stackExchangeSite, query }]
    : []);
  const blueskyQueries = selection.bluesky
    ? selection.blueskyQueries ?? [query]
    : [];
  if (query.length < 2 || query.length > 100) {
    throw new Error("Enter a search phrase between 2 and 100 characters.");
  }
  if (stackExchangeQueries.length > 4) throw new Error("Choose no more than four Stack Exchange communities per sweep.");
  if (new Set(stackExchangeQueries.map(({ site }) => site)).size !== stackExchangeQueries.length) {
    throw new Error("Choose each Stack Exchange community only once.");
  }
  if (stackExchangeQueries.some(({ site, query: term }) =>
    !DISCUSSION_COMMUNITIES.some((community) => community.site === site) ||
    term.trim().length < 2 || term.trim().length > 100,
  )) throw new Error("Each Stack Exchange community needs a listed site and its own 2–100 character search phrase.");
  if (blueskyQueries.length > 4) throw new Error("Use the main phrase plus no more than three alternate Bluesky phrases.");
  if (blueskyQueries.some((term) => term.trim().length < 2 || term.trim().length > 100)) {
    throw new Error("Each Bluesky phrase must contain 2–100 characters.");
  }
  if (new Set(blueskyQueries.map((term) => term.trim().normalize("NFKC").toLocaleLowerCase())).size !== blueskyQueries.length) {
    throw new Error("Use a different phrase for each Bluesky language search.");
  }
  const lemmyInstances = selection.lemmyInstances ?? [LEMMY_INSTANCES[0].host];
  const lemmyLocalInstances = new Set(selection.lemmyLocalInstances ?? []);
  if (selection.lemmy && (!lemmyInstances.length || lemmyInstances.some(
    (host) => !LEMMY_INSTANCES.some((instance) => instance.host === host),
    ) || lemmyInstances.length > LEMMY_INSTANCES.length)) {
    throw new Error(`Choose one to ${LEMMY_INSTANCES.length} listed public Lemmy instances.`);
  }
  if (selection.lemmy && [...lemmyLocalInstances].some((host) => !lemmyInstances.includes(host))) {
    throw new Error("Local Lemmy views must be selected instances in this search.");
  }
  if (selection.lemmy && selection.lemmyQueries) {
    if (selection.lemmyQueries.length !== new Set(lemmyInstances).size ||
      new Set(selection.lemmyQueries.map(({ host }) => host)).size !== selection.lemmyQueries.length ||
      lemmyInstances.some((host) => !selection.lemmyQueries!.some((item) => item.host === host)) ||
      selection.lemmyQueries.some(({ query: term }) => term.trim().length < 2 || term.trim().length > 100)) {
      throw new Error("Provide one 2–100 character search phrase for every selected Lemmy instance.");
    }
  }
  const mastodonQueries = selection.mastodonQueries ?? (selection.mastodon ? [selection.mastodon] : []);
  const mastodonLocalInstances = new Set<string>(selection.mastodonLocalInstances ?? []);
  if (!selection.globalVoices && !selection.theConversation && !selection.crossref && !selection.openAlex && !selection.arxiv && !selection.manifoldForecasts && !stackExchangeQueries.length && !selection.lemmy && !mastodonQueries.length && !blueskyQueries.length && !selection.wikimediaLanguage) {
    throw new Error("Select at least one source.");
  }
  if (selection.wikimediaLanguage && !WIKIMEDIA_TALK_WIKIS.some(({ language }) => language === selection.wikimediaLanguage)) {
    throw new Error("Choose a listed Wikimedia language edition.");
  }
  const mastodonQueryKeys = mastodonQueries.map(({ hashtag, instance }) => `${instance}\u0000${hashtag.trim().replace(/^#+/, "").normalize("NFKC").toLocaleLowerCase()}`);
  const mastodonQueriesPerInstance = new Map<string, number>();
  for (const { instance } of mastodonQueries) mastodonQueriesPerInstance.set(instance, (mastodonQueriesPerInstance.get(instance) ?? 0) + 1);
  if (mastodonQueries.length > MASTODON_INSTANCES.length * 3 || new Set(mastodonQueryKeys).size !== mastodonQueryKeys.length || mastodonQueries.some(({ hashtag, instance }) =>
    !MASTODON_INSTANCES.some(({ host }) => host === instance) || !/^[\p{L}\p{N}_-]{1,50}$/u.test(hashtag.trim().replace(/^#+/, "")),
  ) || [...mastodonQueriesPerInstance.values()].some((count) => count > 3)) {
    throw new Error("Choose up to three distinct valid hashtags per listed Mastodon server.");
  }
  if (selection.mastodonLocalInstances && [...mastodonLocalInstances].some((host) =>
    !mastodonQueries.some((item) => item.instance === host))) {
    throw new Error("A local Mastodon community must also have a selected hashtag search.");
  }
  const tasks: Promise<ResearchSweepSourceResult>[] = [];
  const conversationTasks: Promise<ResearchSweepSourceResult[]>[] = [];
  if (selection.manifoldForecasts) {
    tasks.push(capture(
      "manifold-forecasts",
      "Manifold · community forecasts (play money)",
      query,
      asOf,
      "Open binary questions · MANA play-money only · recent traded volume required · up to 20 API matches before relevance filtering",
      async () => (await searchManifoldForecasts(query, boundedFetch, now)).map((market) => ({
        id: `manifold:${market.id}`,
        title: market.question,
        url: market.url,
        source: "Manifold community forecast · MANA play money",
        evidenceClass: "crowd forecast" as const,
        language: "Not reported",
        timeLabel: "Observed",
        timeValue: market.updatedAt,
        context: `Current community probability: ${(market.probability * 100).toFixed(1)}% YES. Recent volume: ${market.volume24Hours.toFixed(1)} MANA; liquidity: ${market.liquidity.toFixed(1)} MANA.${market.closesAt ? ` Closes ${market.closesAt.slice(0, 10)}.` : " No close date reported."} MANA is virtual play money, not fiat or a real-money price. Self-selected platform forecasts are not surveys, verified probabilities, or country views.`,
        sourceOperatorKey: "manifold",
        sourceOperatorLabel: "Manifold Markets",
      })),
    ));
  }
  if (selection.globalVoices) {
    for (const [index, term] of [query, ...additionalQueries.map((value) => value.trim())].entries()) {
      tasks.push((async () => {
      const key = index === 0 ? "global-voices" : `global-voices:alternate:${index}`;
      const label = index === 0 ? "Global Voices · multilingual reporting" : `Global Voices · alternate phrase ${index}`;
      try {
        const response = await boundedFetch("/api/research/global-voices", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query: term }),
        });
        if (!response.ok) throw new Error(response.status === 429
          ? "Global Voices search limit reached. Try again in one minute."
          : "Global Voices search is temporarily unavailable.");
        const body = await response.json() as { editions?: GlobalVoicesEditionResult[] };
        if (!Array.isArray(body.editions)) throw new Error("Global Voices returned an unexpected response.");
        const available = body.editions.filter(({ error }) => !error);
        if (!available.length) throw new Error("All Global Voices language editions are temporarily unavailable.");
        const unavailable = body.editions.filter(({ error }) => error);
        const evidence = available.flatMap(({ edition, language, articles }) => articles.map((article) => ({
          id: `global-voices:${article.id}`,
          title: article.title,
          url: article.url,
          source: `Global Voices · ${edition} edition`,
          evidenceClass: "news coverage" as const,
          language,
          timeLabel: "Published",
          timeValue: article.publishedAt,
          context: "Headline matches the submitted phrase; article body was not retrieved. Edition language does not identify the people or audience represented",
          attribution: "Global Voices headline",
          attributionUrl: "https://globalvoices.org/about/global-voices-attribution-policy/",
          sourceOperatorKey: "global-voices",
          sourceOperatorLabel: "Global Voices",
        })));
        return {
          key,
          label,
          query: term,
          asOf,
          retrievedAt: new Date().toISOString(),
          window: `${available.length}/${body.editions.length} editions · last 30 days · headline terms must match; up to 5 per edition`,
          evidence,
          error: null,
          ...(unavailable.length ? { coverageNote: `${unavailable.length} of ${body.editions.length} language editions were unavailable: ${unavailable.map(({ edition }) => edition).join(", ")}.` } : {}),
          status: unavailable.length ? "partial" : "complete",
        };
      } catch (cause) {
        return { key, label, query: term, asOf, retrievedAt: new Date().toISOString(), window: "Localized edition search · last 30 days · headline metadata shown", evidence: [], error: cause instanceof Error ? cause.message : "Global Voices search is unavailable.", status: "unavailable" };
      }
      })());
    }
  }
  if (selection.theConversation) {
    conversationTasks.push((async () => {
      try {
        const response = await boundedFetch("/api/research/the-conversation", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error(response.status === 429
          ? "The Conversation search limit reached. Try again in one minute."
          : "The Conversation feeds are temporarily unavailable.");
        const body = await response.json() as { editions?: TheConversationSearchEdition[] };
        if (!Array.isArray(body.editions)) throw new Error("The Conversation returned an unexpected response.");
        return body.editions.map((edition) => ({
          key: `the-conversation:${edition.code}`,
          label: `The Conversation · ${edition.edition} edition · expert analysis`,
          query,
          asOf,
          retrievedAt: new Date().toISOString(),
          window: "Headline title matches · up to 5 · last 30 days",
          evidence: edition.articles.map((article) => ({
            id: `the-conversation:${article.id}`,
            title: article.title,
            url: article.url,
            source: `The Conversation · ${edition.edition} edition`,
            evidenceClass: "expert analysis" as const,
            language: edition.language,
            timeLabel: "Published",
            timeValue: article.publishedAt,
            context: "Headline-only expert analysis; edition does not establish author or audience location",
            attribution: `Author: ${article.authors.join(", ")}`,
            licenseName: "Creative Commons · attribution/no derivatives (feed notice)",
            licenseUrl: "https://theconversation.com/republishing-guidelines",
            sourceOperatorKey: "the-conversation",
            sourceOperatorLabel: "The Conversation",
          })),
          error: edition.error,
          coverageNote: "English-language expert analysis headlines only; this publisher's edition is not a country sample. Article bodies are not retrieved for search display or AI synthesis.",
          status: edition.error ? "unavailable" as const : "complete" as const,
        }));
      } catch (cause) {
        return ["uk", "ca", "africa", "nz", "au", "us"].map((code) => ({
          key: `the-conversation:${code}`,
          label: `The Conversation · ${code.toUpperCase()} edition · expert analysis`,
          query,
          asOf,
          retrievedAt: new Date().toISOString(),
          window: "Headline title matches · last 30 days",
          evidence: [],
          error: cause instanceof Error ? cause.message : "The Conversation search is unavailable.",
          coverageNote: "English-language expert analysis headlines only; this publisher's edition is not a country sample.",
          status: "unavailable" as const,
        }));
      }
    })());
  }
  if (selection.crossref) {
    tasks.push(capture(
      "crossref",
      "Crossref · recent global research literature",
      query,
      asOf,
      "Title-matched DOI metadata · publication date within 5 years · up to 12 records",
      async () => {
        const response = await boundedFetch("/api/research/crossref", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error(response.status === 429
          ? "Crossref search limit reached. Try again in one minute."
          : "Crossref research metadata is temporarily unavailable.");
        const body = await response.json() as { works?: CrossrefWork[] };
        if (!Array.isArray(body.works)) throw new Error("Crossref returned an unexpected response.");
        return body.works.map((work) => ({
          id: `crossref:${work.doi}`,
          title: work.title,
          url: work.url,
          source: work.containerTitle ? `Crossref · ${work.containerTitle}` : "Crossref · research literature",
          evidenceClass: "research literature" as const,
          language: work.language,
          timeLabel: "Published · date precision varies",
          timeValue: work.publishedAt,
          context: `Bibliographic metadata deposited with Crossref${work.publisher ? ` by ${work.publisher}` : ""}. The publication date may specify only a year or month. Not public discussion, not a country sample, and not an assessment of study quality.`,
          attribution: "Crossref metadata",
          attributionUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
          sourceOperatorKey: "crossref",
          sourceOperatorLabel: "Crossref",
        }));
      },
    ));
  }
  if (selection.openAlex) {
    tasks.push(capture(
      "openalex",
      "OpenAlex · recent global research literature",
      query,
      asOf,
      "Title-matched metadata · publication date within 5 years · up to 12 records",
      async () => {
        const response = await boundedFetch("/api/research/openalex", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error(response.status === 429
          ? "OpenAlex search limit reached. Try again in one minute."
          : "OpenAlex research metadata is temporarily unavailable.");
        const body = await response.json() as { works?: OpenAlexWork[] };
        if (!Array.isArray(body.works)) throw new Error("OpenAlex returned an unexpected response.");
        return body.works.map((work) => ({
          id: `openalex:${work.id}`,
          title: work.title,
          url: work.url,
          source: `OpenAlex · ${work.workType || "research work"}`,
          evidenceClass: "research literature" as const,
          language: "Not reported",
          timeLabel: "Published",
          timeValue: work.publishedAt,
          context: `OpenAlex scholarly metadata${work.openAccess === null ? "; access status not reported" : work.openAccess ? "; marked open access by OpenAlex" : "; not marked open access by OpenAlex"}. Title-level record only; not public discussion, not a country sample, and not an assessment of study quality.`,
          attribution: "OpenAlex metadata",
          attributionUrl: "https://help.openalex.org/access/pricing/",
          licenseName: "Metadata: CC0 1.0",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          sourceOperatorKey: "openalex",
          sourceOperatorLabel: "OpenAlex",
        }));
      },
    ));
  }
  if (selection.arxiv) {
    tasks.push(capture(
      "arxiv",
      "arXiv · recent open research metadata",
      query,
      asOf,
      "Title-matched preprint metadata · submitted within 5 years · up to 12 records",
      async () => {
        const response = await boundedFetch("/api/research/arxiv", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error(response.status === 429
          ? "arXiv search limit reached. Try again in one minute."
          : "arXiv research metadata is temporarily unavailable.");
        const body = await response.json() as { records?: ArxivRecord[] };
        if (!Array.isArray(body.records)) throw new Error("arXiv returned an unexpected response.");
        return body.records.map((record) => ({
          id: `arxiv:${record.id}`,
          title: record.title,
          url: record.url,
          source: record.category ? `arXiv · ${record.category}` : "arXiv · open research",
          evidenceClass: "research literature" as const,
          language: "Not reported",
          timeLabel: "Submitted",
          timeValue: record.publishedAt,
          context: "Open-access preprint metadata; submission is not peer review, not public discussion, not a country sample, and not an assessment of study quality.",
          attribution: "arXiv metadata",
          attributionUrl: "https://info.arxiv.org/help/api/index.html",
          licenseName: "Metadata: CC0 1.0; paper reuse varies by item",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          sourceOperatorKey: "arxiv",
          sourceOperatorLabel: "arXiv",
        }));
      },
    ));
  }
  for (const { site, query: termInput } of stackExchangeQueries) {
    const term = termInput.trim();
    const community = DISCUSSION_COMMUNITIES.find(({ site: candidate }) => candidate === site)!;
    if (term.length < 3) {
      tasks.push(Promise.resolve({
        key: `stack-exchange:${site}`,
        label: community.label,
        query: term,
        asOf,
        retrievedAt: new Date().toISOString(),
        window: "Title search · last 30 days",
        evidence: [],
        error: "Not searched: this provider requires at least 3 characters. Other selected sources were still searched.",
        status: "not-searched",
      }));
      continue;
    }
    if (term.length > 80) {
      tasks.push(Promise.resolve({
        key: `stack-exchange:${site}`,
        label: community.label,
        query: term,
        asOf,
        retrievedAt: new Date().toISOString(),
        window: "Title search · last 30 days",
        evidence: [],
        error: "Not searched: this provider accepts title-query phrases up to 80 characters. Other selected sources were still searched.",
        status: "not-searched",
      }));
      continue;
    }
    let reusedRecentSearch = false;
    const loadEvidence = async () => (await searchLiveDiscussion(term, site, boundedFetch, now)).map((item) => ({
        id: `stackexchange:${item.url}`,
        title: item.title,
        url: item.url,
        source: item.community,
        evidenceClass: "expert Q&A" as const,
        language: item.language,
        timeLabel: "Published",
        timeValue: item.createdAt,
        context: `Stack Exchange title search in ${item.language}; title-only query, not topic prevalence`,
        attribution: `Author: ${item.author}`,
        attributionUrl: item.authorUrl,
        licenseName: "CC BY-SA 4.0",
        licenseUrl: item.licenseUrl,
        sourceOperatorKey: "stack-exchange",
        sourceOperatorLabel: "Stack Exchange",
      }));
    const searchEvidence = fetcher === fetch
      ? cachedStackExchangeSearch(site, term, now, loadEvidence, () => { reusedRecentSearch = true; })
      : loadEvidence();
    tasks.push(capture(
      `stack-exchange:${site}`,
      community.label,
      term,
      asOf,
      "Title matches within 30 days",
      () => searchEvidence,
      () => {
        const notes = [
          reusedRecentSearch ? "Reused a matching result retrieved within the past 65 seconds to respect the provider's duplicate-query guidance." : undefined,
        ];
        if (site === stackExchangeQueries[0]?.site) {
          const status = getStackExchangeThrottleStatus();
          if (status.quotaRemaining !== null) notes.push(`Most recent Stack Exchange API response reported quota_remaining=${status.quotaRemaining}; available quota may be shared and can vary.`);
        }
        return notes.filter(Boolean).join(" ") || undefined;
      },
    ));
  }
  if (selection.lemmy) {
    for (const host of new Set(lemmyInstances)) {
      const term = selection.lemmyQueries?.find((item) => item.host === host)?.query.trim() ?? query;
      const listingType: LemmyListingType = lemmyLocalInstances.has(host) ? "local" : "all";
      const viewLabel = listingType === "local" ? "locally hosted communities" : "federated search";
      tasks.push(capture(`lemmy:${host}`, `Lemmy · ${host} · ${viewLabel}`, term, asOf, "Recent posts within 7 days; up to 20 per server view", async () =>
      (await searchLemmyPosts(term, host, boundedFetch, now, listingType)).map((post) => ({
        id: `lemmy:${post.url}`,
        title: post.title,
        url: post.url,
        source: `Lemmy · ${host} / c/${post.community}`,
        evidenceClass: "social discussion" as const,
        context: [
          `Lemmy ${listingType === "local" ? "locally hosted community" : "federated search"}; instance hosting does not establish poster nationality or residence`,
          includesExternalLink(post.transientPreview) ? LINKED_POST_CAVEAT : undefined,
        ].filter(Boolean).join(" "),
        language: post.languageId === null ? "not provided" : `Lemmy language metadata ID ${post.languageId} (instance-specific; language not mapped)`,
        timeLabel: "Published",
        timeValue: post.publishedAt,
        linkSharing: includesExternalLink(post.transientPreview),
        attribution: `Lemmy author: ${post.author}`,
        attributionUrl: post.authorUrl ?? post.url,
        // Treat federated instance searches as one Lemmy source class; multiple instances can overlap.
        sourceOperatorKey: "lemmy-federation",
        sourceOperatorLabel: "Lemmy federated search",
        transientPreview: post.transientPreview,
      })),
      ));
    }
  }
  for (const { hashtag, instance } of mastodonQueries) {
    const server = MASTODON_INSTANCES.find(({ host }) => host === instance)!;
    const sameServerQueryCount = mastodonQueriesPerInstance.get(instance) ?? 1;
    const resultKey = sameServerQueryCount === 1 ? `mastodon:${instance}` : `mastodon:${instance}:${hashtag.toLocaleLowerCase()}`;
    const localCommunity = mastodonLocalInstances.has(instance);
    const communityLabel = localCommunity ? " · language/community-focused server" : "";
    tasks.push(capture(resultKey, `Mastodon · ${server.label}${communityLabel} · #${hashtag}`, `#${hashtag}`, asOf, "Public hashtag posts from the last 30 days; up to 20 API items per tag", async () =>
      (await searchPublicHashtag(hashtag, boundedFetch, now, server.host)).map((post) => ({
        id: `mastodon:${post.url}`,
        title: `Public post by @${post.authorHandle}`,
        url: post.url,
        source: `Mastodon · ${post.originServer} via ${server.host}`,
        evidenceClass: "social discussion" as const,
        language: post.language ?? "not provided",
        timeLabel: "Published",
        timeValue: post.createdAt,
        context: [
          post.contentWarning
            ? `Content warning: ${post.contentWarning.slice(0, 200)}; preview withheld, open the original post if appropriate`
            : `Public hashtag #${hashtag} search; ${localCommunity ? "this server's language/community focus does not verify poster nationality or residence" : "server timeline is not a geographic market proxy"}`,
          post.accountMarkedAutomated
            ? "This account is marked automated by the instance; shown with its source link but omitted from AI discussion synthesis."
            : undefined,
          includesExternalLink(post.contentHtml) ? LINKED_POST_CAVEAT : undefined,
        ].filter(Boolean).join(" "),
        attribution: `Author: ${post.authorHandle}`,
        attributionUrl: post.authorUrl,
        linkSharing: includesExternalLink(post.contentHtml),
        // The selected server is the query operator; multiple Mastodon servers are one network class.
        sourceOperatorKey: "mastodon-network",
        sourceOperatorLabel: "Mastodon public instances",
        transientPreview: post.contentWarning || post.accountMarkedAutomated
          ? undefined
          : mastodonHtmlToTransientText(post.contentHtml),
      })),
      ));
  }
  for (const [index, termInput] of blueskyQueries.entries()) {
    const term = termInput.trim();
    let sourceNote: string | undefined;
    tasks.push(capture(`bluesky:${index}`, `Bluesky · search ${index + 1}`, term, asOf, "Up to 25 newest indexed posts within 7 days", async () => {
      const posts = await searchBlueskyPosts(term, boundedFetch, now);
      sourceNote = concentratedBylineNote(posts.map(({ authorHandle }) => authorHandle));
      return posts.map((post) => ({
        id: `bluesky:${post.uri}`,
        title: post.title,
        url: post.url,
        source: `Bluesky public AppView · search ${index + 1}`,
        evidenceClass: "social discussion" as const,
        language: post.language,
        timeLabel: "Published",
        timeValue: post.publishedAt,
        sourceOperatorKey: "bluesky",
        sourceOperatorLabel: "Bluesky",
        transientPreview: post.transientPreview,
        linkSharing: includesExternalLink(post.transientPreview),
        context: [
          post.duplicateCount > 1
            ? `Identical normalized text appeared in ${post.duplicateCount} indexed posts and is shown once. Repeated copies are not independent corroboration; author independence is unverified.`
            : null,
          post.contentWarning,
          includesExternalLink(post.transientPreview) ? LINKED_POST_CAVEAT : undefined,
        ].filter(Boolean).join(" ") || "Visitor-entered language variants are kept as separate searches and are not translated or pooled; indexed subset, not a complete or representative feed",
        attribution: `Author: @${post.authorHandle}`,
      }));
    }, () => sourceNote));
  }
  if (selection.wikimediaLanguage) {
    const language = selection.wikimediaLanguage;
    const wiki = WIKIMEDIA_TALK_WIKIS.find(({ language: candidate }) => candidate === language)!;
    tasks.push(capture("wikimedia", wiki.wiki, query, asOf, "Talk pages edited within 90 days; up to 20", async () =>
      (await searchWikimediaTalk(query, language, boundedFetch, now)).map((page) => ({
        id: `wikimedia-talk:${page.url}`,
        title: page.title,
        url: page.url,
        source: page.wiki,
        evidenceClass: "editorial discussion" as const,
        language: page.language,
        timeLabel: "Last edited",
        timeValue: page.lastEditedAt,
        context: "Article talk page; collaborative editorial discussion, not a general forum",
        attribution: "View page history and contributors",
        attributionUrl: page.historyUrl,
        sourceOperatorKey: "wikimedia",
        sourceOperatorLabel: "Wikimedia projects",
      })),
    ));
  }
  const [results, conversationResults] = await Promise.all([
    Promise.all(tasks),
    Promise.all(conversationTasks),
  ]);
  return [...results, ...conversationResults.flat()];
}

function cachedStackExchangeSearch(
  site: string,
  query: string,
  now: number,
  load: () => Promise<ResearchEvidence[]>,
  onReuse: () => void,
): Promise<ResearchEvidence[]> {
  for (const [key, value] of stackExchangeRecentSearches) {
    if (value.expiresAt <= now) stackExchangeRecentSearches.delete(key);
  }
  const key = `${site}\u0000${query.normalize("NFKC").toLocaleLowerCase()}`;
  const existing = stackExchangeRecentSearches.get(key);
  if (existing && existing.expiresAt > now) {
    onReuse();
    return existing.result;
  }
  if (stackExchangeRecentSearches.size >= STACK_EXCHANGE_CACHE_LIMIT) {
    stackExchangeRecentSearches.delete(stackExchangeRecentSearches.keys().next().value!);
  }
  const result = load().catch((cause) => {
    if (stackExchangeRecentSearches.get(key)?.result === result) stackExchangeRecentSearches.delete(key);
    throw cause;
  });
  stackExchangeRecentSearches.set(key, { expiresAt: now + STACK_EXCHANGE_REPEAT_WINDOW_MS, result });
  return result;
}

async function capture(
  key: ResearchSweepSourceResult["key"],
  label: string,
  query: string,
  asOf: string,
  window: string,
  search: () => Promise<ResearchEvidence[]>,
  getSourceNote?: () => string | undefined,
): Promise<ResearchSweepSourceResult> {
  try {
    const evidence = await search();
    const sourceNote = getSourceNote?.();
    return { key, label, query, asOf, retrievedAt: new Date().toISOString(), window, evidence, error: null, status: "complete", ...(sourceNote ? { sourceNote } : {}) };
  } catch (cause) {
    return {
      key,
      label,
      query,
      asOf,
      retrievedAt: new Date().toISOString(),
      window,
      evidence: [],
      error: cause instanceof Error ? cause.message : "This source is temporarily unavailable.",
      status: "unavailable",
    };
  }
}

function concentratedBylineNote(bylines: string[]) {
  if (bylines.length < 3) return undefined;
  const counts = new Map<string, number>();
  for (const byline of bylines) counts.set(byline, (counts.get(byline) ?? 0) + 1);
  const maximum = Math.max(...counts.values());
  if (maximum / bylines.length < 0.6) return undefined;
  const share = Math.round((maximum / bylines.length) * 100);
  return `Sample composition: one displayed handle appears in ${maximum} of ${bylines.length} unique-text results (${share}%). This flags byline concentration; it does not verify identity or independence.`;
}

function includesExternalLink(value: string | undefined) {
  return typeof value === "string" && /(?:https?:\/\/|www\.)|<a\b[^>]*\bhref\s*=\s*["']https?:\/\//iu.test(value);
}
