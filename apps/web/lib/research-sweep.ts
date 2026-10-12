import { searchBlueskyPosts } from "./bluesky-public";
import { withFetchTimeout } from "./fetch-with-timeout";
import type { GlobalVoicesEditionResult } from "./global-voices-search";
import { DISCUSSION_COMMUNITIES, getStackExchangeThrottleStatus, searchLiveDiscussion } from "./live-topic-search";
import { getLemmyLanguageCatalog, LEMMY_INSTANCES, LemmyInstance, LemmyListingType, searchLemmyPostPage } from "./lemmy-public";
import { MASTODON_INSTANCES, mastodonHtmlToTransientText, searchPublicHashtag } from "./mastodon-public";
import type { MastodonInstance } from "./mastodon-public";
import { WIKIMEDIA_TALK_WIKIS, searchWikimediaTalk } from "./wikimedia-talk";
import type { TheConversationSearchEdition } from "./the-conversation-search";
import type { ResearchEvidence } from "./research-brief";
import type { CrossrefWork } from "./crossref-search";
import type { ArxivRecord } from "./arxiv-search";
import { scholarlyContextNote } from "./scholarly-context-relevance";
import { SCHOLARLY_TITLE_MATCH_NOTE } from "./scholarly-title-match";
import { PYTORCH_COVERAGE, PYTORCH_WINDOW, pytorchAppliesToQuery, type PytorchSample } from "./pytorch-forum";
import { searchManifoldForecasts } from "./manifold-search";
import type { OpenAlexWork } from "./openalex-search";
import type { SecFilingSearch } from "./sec-edgar-research-search";
import { searchWorldBankMacro, worldBankCountryCodes, worldBankIndicatorForQuery } from "./world-bank-macro";
import { eiaSeriesForQuery } from "./eia-energy-search";
import { bisEerAppliesToQuery } from "./bis-effective-exchange";
import { isValidTopicHashtag } from "./topic-hashtags";
import { includesExternalLink } from "./external-links";
export { includesExternalLink } from "./external-links";

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
  /** Bounded licensed technical first-post sample; never treated as a national/AI view. */
  pytorch?: boolean;
  /** Visitor-triggered play-money prediction markets; never fed into country/community summaries. */
  manifoldForecasts?: boolean;
  /** Visitor-triggered exact issuer lookup; official filings are source context, never conversation evidence. */
  secEdgar?: boolean;
  /** Narrow keyless macro context; never treated as public conversation or summarized by AI. */
  worldBankCountryCode?: string;
  /** Optional server-side-only EIA market context; queried only for exact energy concepts. */
  eiaEnergyPrices?: boolean;
  /** Keyless BIS currency context, limited to effective-rate searches and excluded from AI discussion. */
  bisCountryCode?: string;
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
  /** Raw provider return total retained when a visitor-facing topic screen is applied. */
  providerReturnedCount?: number;
  /** Provider records removed by freshness/moderation/record-safety checks, before the topic screen. */
  adapterExcludedCount?: number;
  /** Number of raw records excluded by the transparent visitor-facing topic screen. */
  topicExcludedCount?: number;
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
  if (!(selection.pytorch && pytorchAppliesToQuery(query)) && !selection.globalVoices && !selection.theConversation && !selection.crossref && !selection.openAlex && !selection.arxiv && !selection.manifoldForecasts && !selection.secEdgar && !(selection.worldBankCountryCode && worldBankIndicatorForQuery(query)) && !(selection.eiaEnergyPrices && eiaSeriesForQuery(query).length) && !(selection.bisCountryCode && bisEerAppliesToQuery(query)) && !stackExchangeQueries.length && !selection.lemmy && !mastodonQueries.length && !blueskyQueries.length && !selection.wikimediaLanguage) {
    throw new Error("Select at least one source.");
  }
  if (selection.wikimediaLanguage && !WIKIMEDIA_TALK_WIKIS.some(({ language }) => language === selection.wikimediaLanguage)) {
    throw new Error("Choose a listed Wikimedia language edition.");
  }
  const mastodonQueryKeys = mastodonQueries.map(({ hashtag, instance }) => `${instance}\u0000${hashtag.trim().replace(/^#+/, "").normalize("NFKC").toLocaleLowerCase()}`);
  const mastodonQueriesPerInstance = new Map<string, number>();
  for (const { instance } of mastodonQueries) mastodonQueriesPerInstance.set(instance, (mastodonQueriesPerInstance.get(instance) ?? 0) + 1);
  if (mastodonQueries.length > MASTODON_INSTANCES.length * 3 || new Set(mastodonQueryKeys).size !== mastodonQueryKeys.length || mastodonQueries.some(({ hashtag, instance }) =>
    !MASTODON_INSTANCES.some(({ host }) => host === instance) || !isValidTopicHashtag(hashtag.trim().replace(/^#+/, "")),
  ) || [...mastodonQueriesPerInstance.values()].some((count) => count > 3)) {
    throw new Error("Choose up to three distinct valid hashtags per listed Mastodon server.");
  }
  if (selection.mastodonLocalInstances && [...mastodonLocalInstances].some((host) =>
    !mastodonQueries.some((item) => item.instance === host))) {
    throw new Error("A local Mastodon community must also have a selected hashtag search.");
  }
  const tasks: Promise<ResearchSweepSourceResult>[] = [];
  const conversationTasks: Promise<ResearchSweepSourceResult[]>[] = [];
  if (selection.bisCountryCode && bisEerAppliesToQuery(query)) {
    tasks.push((async () => {
      const label = "BIS · official effective-exchange-rate context";
      const window = "Monthly nominal and real broad-basket indices · U.S. and selected country · about 3 years";
      try {
        const response = await boundedFetch("/api/research/bis", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query, country: selection.bisCountryCode }),
        });
        if (!response.ok) throw new Error(response.status === 429
          ? "BIS search limit reached. Try again in one minute."
          : "BIS exchange-rate context is temporarily unavailable.");
        const body = await response.json() as { evidence?: unknown; missingSeries?: unknown; staleSeries?: unknown; failedAreas?: unknown; retrievedAt?: unknown };
        if (!Array.isArray(body.evidence) || !Array.isArray(body.missingSeries) || !Array.isArray(body.staleSeries) || !Array.isArray(body.failedAreas)) {
          throw new Error("BIS returned an unexpected response.");
        }
        const evidence = body.evidence.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const item = value as ResearchEvidence;
          let url: URL;
          let licenseUrl: URL;
          try { url = new URL(item.url); licenseUrl = new URL(item.licenseUrl ?? ""); } catch { return []; }
          if (typeof item.id !== "string" || !/^bis-eer:(?:US|KR|JP|DE|FR|BR|IN|ES):[NR]:\d{4}-\d{2}$/u.test(item.id) ||
            typeof item.title !== "string" || typeof item.context !== "string" || item.evidenceClass !== "official statistical data" ||
            url.protocol !== "https:" || url.hostname !== "data.bis.org" || !url.pathname.startsWith("/topics/EER/") ||
            licenseUrl.toString() !== "https://data.bis.org/help/legal" || item.sourceOperatorKey !== "bis-statistics" ||
            item.summaryEligible !== false) return [];
          return [item];
        }).slice(0, 4);
        const missingSeries = body.missingSeries.filter((value): value is string => typeof value === "string").slice(0, 4);
        const staleSeries = body.staleSeries.filter((value): value is string => typeof value === "string").slice(0, 4);
        const failedAreas = body.failedAreas.filter((value): value is string => typeof value === "string").slice(0, 2);
        const notes = [
          failedAreas.length ? "BIS returned no usable response for " + failedAreas.join(", ") + "." : "",
          missingSeries.length ? "No usable data for " + missingSeries.join(", ") + "." : "",
          staleSeries.length ? "Latest observations are more than 100 days old for " + staleSeries.join(", ") + "." : "",
          !evidence.length && !missingSeries.length ? "No valid BIS observations were returned; this does not indicate that the topic or currency is absent." : "",
        ].filter(Boolean);
        return {
          key: "bis-effective-exchange",
          label,
          query,
          asOf,
          retrievedAt: typeof body.retrievedAt === "string" ? body.retrievedAt : new Date().toISOString(),
          window,
          evidence,
          error: null,
          ...(notes.length ? { coverageNote: notes.join(" ") } : {}),
          status: evidence.length ? notes.length ? "partial" as const : "complete" as const : failedAreas.length ? "unavailable" as const : "partial" as const,
          sourceNote: "Official trade-weighted index context only; not a bilateral spot quote, discussion sample, investor view, or AI-summary evidence.",
        };
      } catch (cause) {
        return {
          key: "bis-effective-exchange", label, query, asOf, retrievedAt: new Date().toISOString(), window,
          evidence: [], error: cause instanceof Error ? cause.message : "BIS exchange-rate context is unavailable.", status: "unavailable" as const,
        };
      }
    })());
  }
  if (selection.worldBankCountryCode) {
    const indicator = worldBankIndicatorForQuery(query);
    if (indicator) {
      tasks.push((async () => {
        const result = await capture(
          "world-bank-macro",
          "World Bank · official annual macro context",
          query,
          asOf,
          `${indicator.label} · latest three available annual observations for U.S., selected country, and world aggregate · no general keyword matching`,
          () => searchWorldBankMacro(query, selection.worldBankCountryCode!, boundedFetch),
        );
        if (result.status !== "complete") return result;
        const presentCountryCodes = new Set(result.evidence.map(({ id }) => id.split(":")[2]));
        const missingCountryCodes = worldBankCountryCodes(selection.worldBankCountryCode!).filter((code) => !presentCountryCodes.has(code));
        if (!missingCountryCodes.length) return result;
        const missing = missingCountryCodes.join(", ");
        return {
          ...result,
          status: result.evidence.length ? "partial" as const : "complete" as const,
          coverageNote: result.evidence.length
            ? `No usable annual observation was returned for ${missing}. Other requested geographies are shown; annual series coverage and publication lags vary.`
            : "No observation was returned for the requested geographies. This does not mean the indicator or topic is absent; World Bank series can be incomplete or delayed.",
        };
      })());
    }
  }
  if (selection.eiaEnergyPrices && eiaSeriesForQuery(query).length) {
    const label = "EIA · U.S. energy benchmark prices";
    tasks.push((async () => {
      const window = `${eiaSeriesForQuery(query).map(({ id }) => id).join(" / ")} · up to five latest daily observations per mapped series`;
      try {
        const response = await boundedFetch("/api/research/eia", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const retrievedAt = new Date().toISOString();
        if (response.status === 503) {
          const unavailable = await response.json().catch(() => null) as { code?: unknown } | null;
          if (unavailable?.code === "not_configured") return {
            key: "eia-energy-prices", label, query, asOf, retrievedAt, window, evidence: [],
            error: "Not searched: the operator must add a free EIA_API_KEY to private server settings after registering with EIA and accepting its API terms.",
            status: "not-searched" as const,
          };
        }
        if (!response.ok) throw new Error(response.status === 429 ? "EIA search limit reached. Try again in one minute." : "EIA data is temporarily unavailable.");
        const payload = await response.json() as { evidence?: unknown; retrievedAt?: unknown };
        if (!Array.isArray(payload.evidence)) throw new Error("EIA returned an unexpected response.");
        const allowedSeries = new Set(eiaSeriesForQuery(query).map(({ id }) => id));
        const evidence = payload.evidence.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const item = value as ResearchEvidence;
          let url: URL;
          try { url = new URL(item.url); } catch { return []; }
          if (typeof item.id !== "string" || !/^eia:(?:RWTC|RBRTE|RNGWHHD):\d{4}-\d{2}-\d{2}$/.test(item.id) ||
            !allowedSeries.has(item.id.split(":")[1] as "RWTC" | "RBRTE" | "RNGWHHD") ||
            typeof item.title !== "string" || typeof item.context !== "string" || item.evidenceClass !== "official statistical data" ||
            url.protocol !== "https:" || url.hostname !== "www.eia.gov" || !url.pathname.startsWith("/opendata/browser/")) return [];
          return [item];
        }).slice(0, 15);
        const observedSeries = new Set(evidence.map(({ id }) => id.split(":")[1]));
        const requestedSeries = eiaSeriesForQuery(query);
        const missingSeries = requestedSeries.filter(({ id }) => !observedSeries.has(id));
        const staleSeries = requestedSeries.filter(({ id }) => {
          const latest = evidence.filter((item) => item.id.split(":")[1] === id).map((item) => Date.parse(item.timeValue)).sort((a, b) => b - a)[0];
          return latest !== undefined && now - latest > 14 * 24 * 60 * 60 * 1000;
        });
        const coverageNotes = [
          missingSeries.length
            ? evidence.length
              ? `No usable daily observations were returned for ${missingSeries.map(({ label }) => label).join(", ")}; the remaining benchmark series are shown.`
              : "The API returned no usable observations for the requested benchmarks; this does not mean energy-market data or discussion is absent."
            : undefined,
          staleSeries.length
            ? `Latest available observations are more than 14 days old for ${staleSeries.map(({ label }) => label).join(", ")}; verify the publisher's update schedule before relying on them.`
            : undefined,
        ].filter(Boolean).join(" ");
        return {
          key: "eia-energy-prices", label, query, asOf,
          retrievedAt: typeof payload.retrievedAt === "string" ? payload.retrievedAt : retrievedAt,
          window, evidence, error: null,
          status: evidence.length && !coverageNotes ? "complete" as const : "partial" as const,
          ...(coverageNotes ? { coverageNote: coverageNotes } : {}),
        };
      } catch (cause) {
        return { key: "eia-energy-prices", label, query, asOf, retrievedAt: new Date().toISOString(), window, evidence: [], error: cause instanceof Error ? cause.message : "EIA data is temporarily unavailable.", status: "unavailable" as const };
      }
    })());
  }
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
  if (selection.secEdgar) {
    tasks.push((async () => {
      const label = "SEC EDGAR · official filing metadata";
      const window = "Exact company-name/ticker match · selected SEC filings · past 3 years · up to 10";
      try {
        const response = await boundedFetch("/api/research/sec-edgar", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (response.status === 503) {
          const unavailable = await response.json().catch(() => null) as { code?: unknown; error?: unknown } | null;
          if (unavailable?.code === "not_configured") {
            return {
              key: "sec-edgar",
              label,
              query,
              asOf,
              retrievedAt: new Date().toISOString(),
              window,
              evidence: [],
              error: "Not searched: the operator needs to set SEC_USER_AGENT to a descriptive name with a contact email.",
              status: "not-searched" as const,
            };
          }
        }
        if (!response.ok) throw new Error(response.status === 429
          ? "SEC EDGAR search limit reached. Try again in one minute."
          : "SEC EDGAR metadata is temporarily unavailable or not configured.");
        const body = await response.json() as SecFilingSearch & { retrievedAt?: string };
        if (!body || !(body.issuer === null || (typeof body.issuer?.cik === "string" && typeof body.issuer?.ticker === "string" && typeof body.issuer?.name === "string")) || !Array.isArray(body.filings)) {
          throw new Error("SEC EDGAR returned an unexpected response.");
        }
        const issuer = body.issuer;
        return {
          key: "sec-edgar",
          label,
          query,
          asOf,
          retrievedAt: typeof body.retrievedAt === "string" ? body.retrievedAt : new Date().toISOString(),
          window,
          evidence: issuer ? body.filings.flatMap((filing) => {
            if (!filing || typeof filing.form !== "string" || typeof filing.filedAt !== "string" || typeof filing.title !== "string" || typeof filing.url !== "string") return [];
            let url: URL;
            try { url = new URL(filing.url); } catch { return []; }
            if (url.protocol !== "https:" || url.hostname !== "www.sec.gov" || !url.pathname.startsWith("/Archives/edgar/data/")) return [];
            return [{
              id: `sec-edgar:${filing.accession}`,
              title: filing.title,
              url: url.toString(),
              source: `SEC EDGAR · ${issuer.name} (${issuer.ticker})`,
              evidenceClass: "official company disclosure" as const,
              language: "Not reported",
              timeLabel: "Filed",
              timeValue: filing.filedAt,
              context: `Official SEC filing metadata for ${issuer.name} (${issuer.ticker}, CIK ${issuer.cik}). Atlas retrieved filing index metadata only; open the original filing to inspect its contents. A U.S. filing record does not establish global issuer coverage or community opinion.`,
              attribution: "U.S. Securities and Exchange Commission EDGAR",
              attributionUrl: "https://www.sec.gov/edgar/search/",
              sourceOperatorKey: "sec-edgar",
              sourceOperatorLabel: "U.S. Securities and Exchange Commission",
            }];
          }) : [],
          error: null,
          ...(!issuer
            ? { coverageNote: "No exact SEC-listed company-name or ticker match was found. EDGAR covers SEC registrants only; this is not evidence that a company or topic is absent elsewhere." }
            : body.filings.length === 0
              ? { coverageNote: `Matched ${issuer.name} (${issuer.ticker}), but no qualifying filing metadata was returned in the past three years.` }
              : {}),
          status: "complete" as const,
        };
      } catch (cause) {
        return {
          key: "sec-edgar",
          label,
          query,
          asOf,
          retrievedAt: new Date().toISOString(),
          window,
          evidence: [],
          error: cause instanceof Error ? cause.message : "SEC EDGAR metadata is unavailable.",
          status: "unavailable" as const,
        };
      }
    })());
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
  if (selection.pytorch && pytorchAppliesToQuery(query)) {
    tasks.push((async () => {
      let sample: PytorchSample | undefined;
      const result = await capture("pytorch", "PyTorch Forums · technical first-post sample", query, asOf, PYTORCH_WINDOW, async () => {
        const response = await boundedFetch("/api/research/pytorch", {
          method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error("PyTorch latest-topic feed is unavailable or rate-limited.");
        const body = await response.json() as { sample?: PytorchSample };
        if (!body.sample || !Array.isArray(body.sample.evidence)) throw new Error("PyTorch returned an unexpected sample.");
        sample = body.sample;
        return sample.evidence;
      }, () => sample ? `${sample.feedCount} latest feed topics inspected; ${sample.matchingTopics} recent title matches; ${Math.min(sample.matchingTopics, 3)} topic reads; ${sample.failedTopics} failed reads; ${sample.excludedTopics} safety/prose exclusions. General prose: CC BY 4.0 under forum-linked LF terms, with exceptions. Cached provider pages may be up to 15 minutes old.` : undefined,
      () => Boolean(sample && (sample.failedTopics || sample.matchingTopics > 3)));
      return { ...result, ...(sample ? { retrievedAt: sample.retrievedAt } : {}), coverageNote: PYTORCH_COVERAGE };
    })());
  }
  if (selection.crossref) {
    tasks.push(capture(
      "crossref",
      "Crossref · recent global research literature",
      query,
      asOf,
      "Title-matched DOI metadata · earliest possible publication date within 5 years · year/month precision may overlap the present · up to 12 records" + SCHOLARLY_TITLE_MATCH_NOTE + scholarlyContextNote(query),
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
          timeLabel: "Published · provider date precision",
          timeValue: work.publicationDate ?? work.publishedAt,
          context: `Bibliographic metadata deposited with Crossref${work.publisher ? ` by ${work.publisher}` : ""}. The publication date may specify only a year or month; missing month/day are not known. The earliest possible date is used for the five-year screen, so boundary-year records can be omitted and current partial dates can extend into the future. Not public discussion, not a country sample, and not an assessment of study quality.`,
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
      "Title-matched metadata · publication date within 5 years · up to 12 records" + SCHOLARLY_TITLE_MATCH_NOTE + scholarlyContextNote(query),
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
      "Title-matched preprint metadata · submitted within 5 years · up to 12 records" + SCHOLARLY_TITLE_MATCH_NOTE + scholarlyContextNote(query),
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
    const loadEvidence = async () => (await searchLiveDiscussion(term, site, boundedFetch, now)).flatMap((item) => [
      {
        id: `stackexchange:${item.url}`,
        title: item.title,
        url: item.url,
        source: item.community,
        evidenceClass: "expert Q&A" as const,
        language: item.language,
        timeLabel: "Published",
        timeValue: item.createdAt,
        context: `Stack Exchange question title search in ${item.language}; title matches are not topic prevalence.${item.answerLookupIssue ? ` ${item.answerLookupIssue}` : ""}`,
        attribution: `Question author: ${item.author}`,
        attributionUrl: item.authorUrl,
        licenseName: "CC BY-SA 4.0",
        licenseUrl: item.licenseUrl,
        sourceOperatorKey: "stack-exchange",
        sourceOperatorLabel: "Stack Exchange",
        summaryEligible: false,
      },
      ...(item.answerExcerpt && item.answerUrl && item.answerAuthor && item.answerAuthorUrl && item.answerCreatedAt ? [{
        id: `stackexchange-answer:${item.answerUrl}`,
        title: `Expert answer · question #${item.id}`,
        url: item.answerUrl,
        source: item.community,
        evidenceClass: "expert Q&A" as const,
        language: item.language,
        timeLabel: "Answered",
        timeValue: item.answerCreatedAt,
        context: "Answer excerpt shortened and HTML formatting removed for display. Expert Q&A is not a measure of general investor opinion or topic prevalence.",
        attribution: `Answer author: ${item.answerAuthor}`,
        attributionUrl: item.answerAuthorUrl,
        licenseName: "CC BY-SA 4.0",
        licenseUrl: item.licenseUrl,
        sourceOperatorKey: "stack-exchange",
        sourceOperatorLabel: "Stack Exchange",
        transientPreview: item.answerExcerpt,
        summaryEligible: false,
      }] : []),
    ]);
    let answerLookupIncomplete = false;
    const searchEvidenceBase = fetcher === fetch
      ? cachedStackExchangeSearch(site, term, now, loadEvidence, () => { reusedRecentSearch = true; })
      : loadEvidence();
    const searchEvidence = searchEvidenceBase.then((items) => {
      answerLookupIncomplete = items.some((item) => /answer lookup was unavailable|no shared API quota remaining for answer lookup/iu.test(item.context ?? ""));
      return items;
    });
    tasks.push(capture(
      `stack-exchange:${site}`,
      community.label,
      term,
      asOf,
      "Recent title matches and individually licensed answer excerpts · last 30 days",
      () => searchEvidence,
      () => {
        const notes = [
          reusedRecentSearch ? "Reused a matching result retrieved within the past 65 seconds to respect the provider's duplicate-query guidance." : undefined,
          answerLookupIncomplete
            ? "Question-title search succeeded, but answer lookup was unavailable or the quota was exhausted; no answer excerpts are included."
            : undefined,
        ];
        if (site === stackExchangeQueries[0]?.site) {
          const status = getStackExchangeThrottleStatus();
          if (status.quotaRemaining !== null) notes.push(`Most recent Stack Exchange API response reported quota_remaining=${status.quotaRemaining}; available quota may be shared and can vary.`);
        }
        return notes.filter(Boolean).join(" ") || undefined;
      },
      () => answerLookupIncomplete,
    ));
  }
  if (selection.lemmy) {
    for (const host of new Set(lemmyInstances)) {
      const term = selection.lemmyQueries?.find((item) => item.host === host)?.query.trim() ?? query;
      const listingType: LemmyListingType = lemmyLocalInstances.has(host) ? "local" : "all";
      const viewLabel = listingType === "local" ? "locally hosted communities" : "federated search";
      let languageCatalogAvailable = false;
      let unmappedLanguageCount = 0;
      let rawCount: number | undefined;
      let adapterExcludedCount = 0;
      tasks.push(capture(`lemmy:${host}`, `Lemmy · ${host} · ${viewLabel}`, term, asOf, "Recent posts within 7 days; up to 20 per server view", async () => {
      const [page, languageCatalog] = await Promise.all([
        searchLemmyPostPage(term, host, boundedFetch, now, listingType),
        getLemmyLanguageCatalog(host, boundedFetch),
      ]);
      const posts = page.posts;
      rawCount = page.returnedCount;
      adapterExcludedCount = page.excludedCount;
      languageCatalogAvailable = languageCatalog !== null;
      unmappedLanguageCount = posts.filter((post) => post.languageId !== null && !languageCatalog?.has(post.languageId)).length;
      return posts.map((post) => ({
        id: `lemmy:${post.url}`,
        title: post.title,
        url: post.url,
        source: `Lemmy · ${host} / c/${post.community}`,
        evidenceClass: "social discussion" as const,
        context: [
          `Lemmy ${listingType === "local" ? "locally hosted community" : "federated search"}; instance hosting does not establish poster nationality or residence`,
          !post.transientPreview ? "No post body was returned; the post title is the only transient discussion excerpt available." : undefined,
          post.linkedContent || includesExternalLink(post.transientPreview ?? post.title) ? LINKED_POST_CAVEAT : undefined,
        ].filter(Boolean).join(" "),
        language: post.languageId === null
          ? "not provided"
          : languageCatalog?.get(post.languageId)?.code ?? `Lemmy language metadata ID ${post.languageId} (unmapped by ${host})`,
        timeLabel: "Published",
        timeValue: post.publishedAt,
        linkSharing: post.linkedContent || includesExternalLink(post.transientPreview ?? post.title),
        attribution: `Lemmy author: ${post.author}`,
        attributionUrl: post.authorUrl ?? post.url,
        // Treat federated instance searches as one Lemmy source class; multiple instances can overlap.
        sourceOperatorKey: "lemmy-federation",
        sourceOperatorLabel: "Lemmy federated search",
        // A link post may have no body; its own title is still transient primary evidence.
        transientPreview: post.transientPreview ?? post.title,
      }));
      }, () => [`${rawCount ?? 0} API records returned; ${adapterExcludedCount} excluded by freshness, moderation, bot, or record-safety checks before topic filtering. Outgoing API attachments count as link-sharing even when no URL appears in the excerpt.`, languageCatalogAvailable
        ? unmappedLanguageCount
          ? `${unmappedLanguageCount} post language ID${unmappedLanguageCount === 1 ? " was" : "s were"} not found in ${host}'s live /api/v3/site catalog; those labels remain unresolved. Provider language metadata does not establish author nationality or residence.`
          : `Post language IDs resolved against ${host}'s live /api/v3/site language catalog; provider labels do not establish author nationality or residence.`
        : `The ${host} language catalog was unavailable or incomplete; unresolved IDs remain visible and cannot match a provider language label. Korean, Japanese, or Hindi script-only fallback may still qualify; other unknown languages are excluded.`].join(" ")).then((result) => ({ ...result, ...(rawCount !== undefined ? { providerReturnedCount: rawCount, adapterExcludedCount } : {}) })));
    }
  }
  for (const { hashtag, instance } of mastodonQueries) {
    const server = MASTODON_INSTANCES.find(({ host }) => host === instance)!;
    const sameServerQueryCount = mastodonQueriesPerInstance.get(instance) ?? 1;
    const resultKey = sameServerQueryCount === 1 ? `mastodon:${instance}` : `mastodon:${instance}:${hashtag.toLocaleLowerCase()}`;
    const localCommunity = mastodonLocalInstances.has(instance);
    const communityLabel = localCommunity ? " · local posts only" : "";
    tasks.push(capture(resultKey, `Mastodon · ${server.label}${communityLabel} · #${hashtag}`, `#${hashtag}`, asOf, `${localCommunity ? "Locally hosted public hashtag posts only" : "Public hashtag posts"} · last 30 days · up to 20 API items per tag`, async () =>
      (await searchPublicHashtag(hashtag, boundedFetch, now, server.host, localCommunity)).map((post) => ({
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
          : `Public hashtag #${hashtag} search${localCommunity ? " restricted to statuses hosted on this server" : ""}; ${localCommunity ? "server language/community focus does not verify poster nationality or residence" : "server timeline is not a geographic market proxy"}`,
          post.accountMarkedAutomated
            ? "This account is marked automated by the instance; shown with its source link but omitted from AI discussion synthesis."
            : undefined,
          post.linkedContent ? LINKED_POST_CAVEAT : undefined,
        ].filter(Boolean).join(" "),
        attribution: `Author: ${post.authorHandle}`,
        attributionUrl: post.authorUrl,
        linkSharing: post.linkedContent,
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
        linkSharing: post.linkedContent || includesExternalLink(post.transientPreview),
        context: [
          post.duplicateCount > 1
            ? `Identical normalized text appeared in ${post.duplicateCount} indexed posts and is shown once. Repeated copies are not independent corroboration; author independence is unverified.`
            : null,
          post.contentWarning,
          post.linkedContent || includesExternalLink(post.transientPreview) ? LINKED_POST_CAVEAT : undefined,
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
  isPartial?: () => boolean,
): Promise<ResearchSweepSourceResult> {
  try {
    const evidence = await search();
    const sourceNote = getSourceNote?.();
    return { key, label, query, asOf, retrievedAt: new Date().toISOString(), window, evidence, error: null, status: isPartial?.() ? "partial" : "complete", ...(sourceNote ? { sourceNote } : {}) };
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
