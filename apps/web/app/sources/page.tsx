import Link from "next/link";
import SiteHeader from "../../components/site-header";
import { serverSupabase } from "../../lib/server-supabase";
import { getDisplayTimeZone } from "../../lib/display-timezone";
import { formatTimestamp } from "../../lib/format-time";
import { summarizeConnectorRuns } from "../../lib/source-health";
import { LEMMY_INSTANCES } from "../../lib/lemmy-public";
import { MASTODON_INSTANCES } from "../../lib/mastodon-public";

export const dynamic = "force-dynamic";

function enabledFeeds() {
  try {
    return ["RSS_FEEDS_KR_JSON", "RSS_FEEDS_US_JSON", "RSS_FEEDS_JSON"].some(
      (key) => {
        const feeds = JSON.parse(process.env[key] ?? "[]");
        return (
          Array.isArray(feeds) &&
          feeds.some((value: string) => {
            try {
              const url = new URL(value);
              return (
                ["http:", "https:"].includes(url.protocol) &&
                url.hostname !== "news.google.com" &&
                !url.hostname.endsWith(".news.google.com")
              );
            } catch {
              return false;
            }
          })
        );
      },
    );
  } catch {
    return false;
  }
}
function utc(
  value: string | null,
  timeZone: import("../../lib/time-zones").DisplayTimeZone,
) {
  if (!value) return "not recorded";
  return formatTimestamp(value, timeZone);
}

function globalVoicesEditionSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("editionResults" in metadata) || !Array.isArray(metadata.editionResults)) return null;
  const labels: Record<string, string> = { en: "English", es: "Spanish", fr: "French", pt: "Portuguese", ar: "Arabic", ru: "Russian", it: "Italian", nl: "Dutch", yo: "Yoruba", uk: "Ukrainian", el: "Greek", ca: "Catalan" };
  const results = metadata.editionResults.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.language !== "string" || !labels[item.language]) return [];
    if (item.status === "failed") return [`${labels[item.language]}: unavailable`];
    if (typeof item.feedItemsReceived !== "number" || typeof item.documentsAccepted !== "number" ||
      !Number.isInteger(item.feedItemsReceived) || !Number.isInteger(item.documentsAccepted) ||
      item.feedItemsReceived < 0 || item.documentsAccepted < 0 || item.documentsAccepted > item.feedItemsReceived) return [];
    return [`${labels[item.language]}: ${item.documentsAccepted} eligible / ${item.feedItemsReceived} feed entries`];
  });
  return results.length ? results.join(" · ") : null;
}

type SourceConfig = {
  name: string;
  key: string;
  enabled: boolean;
  detail: string;
  referenceUrl?: string;
  referenceLabel?: string;
  secondaryReferenceUrl?: string;
  secondaryReferenceLabel?: string;
  additionalReferences?: { url: string; label: string }[];
  onDemand?: boolean;
};

export default async function Sources() {
  const timeZone = await getDisplayTimeZone();
  const db = serverSupabase();
  const sources: SourceConfig[] = [
    {
      name: "arXiv · open research metadata",
      key: "arxiv",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://info.arxiv.org/help/api/index.html",
      referenceLabel: "arXiv public API, terms and acknowledgment",
      secondaryReferenceUrl: "https://info.arxiv.org/help/api/tou.html",
      secondaryReferenceLabel: "arXiv API terms of use",
      detail: "One keyless public Atom API request searches up to six topic terms and returns no more than 12 title-matched preprint records submitted within five years. Atlas discards abstracts and author names and retains title, arXiv identifier, submission date, and category only. arXiv metadata is CC0; paper content remains subject to the individual rights holder's license. Preprints are not necessarily peer-reviewed, and this is not discussion or a country sample. Identical searches are kept in a volatile in-memory cache for 24 hours; distinct requests are serialized and spaced at least three seconds apart per server instance, per arXiv guidance. Free-service uptime and cross-instance rate coordination are not guaranteed. Thank you to arXiv for use of its open access interoperability.",
    },
    {
      name: "Crossref · recent scholarly metadata",
      key: "crossref",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
      referenceLabel: "Crossref public REST API and metadata reuse guidance",
      secondaryReferenceUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/",
      secondaryReferenceLabel: "Public access and rate limits",
      detail: "Each search makes one bounded request to Crossref’s free public API, without signup or key, for up to 12 recent five-year title matches. Atlas shows DOI-linked titles and depositor-provided bibliographic metadata only; it does not fetch abstracts or publisher pages. The records are global scholarly literature, not current community opinion, a country sample, or evidence of study quality. Crossref’s public pool has tighter rate limits than its optional paid service; Atlas caches identical queries for 60 seconds, serializes requests and applies a per-client limit best-effort within each server instance.",
    },
    {
      name: "OpenAlex · recent global research metadata",
      key: "openalex",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://help.openalex.org/api/authentication/",
      referenceLabel: "OpenAlex keyless API and rate limits",
      secondaryReferenceUrl: "https://help.openalex.org/access/pricing/",
      secondaryReferenceLabel: "OpenAlex free access and CC0 data",
      detail: "One visitor-triggered search uses OpenAlex’s keyless casual-use budget; no account, API key, payment method, or paid plan is configured. Atlas requests only ID, DOI, title, publication date, work type, and open-access flag, then keeps up to 12 title matches from the last five years. Abstracts and author names are neither requested nor retained. Metadata is CC0. This is global scholarly context, not live discussion, a country sample, or a quality assessment. OpenAlex documents keyless use as free but rate-limited; service availability for anonymous requests is not guaranteed. Atlas rate-limits best-effort per server instance and has no access to OpenAlex's shared keyless-pool quota.",
    },
    {
      name: "Manifold · play-money community forecasts",
      key: "manifold-forecasts",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://docs.manifold.markets/api",
      referenceLabel: "Official Manifold API documentation",
      secondaryReferenceUrl: "https://manifold.markets/terms-of-service",
      secondaryReferenceLabel: "Manifold Terms of Service",
      detail: "One visitor-triggered, read-only public API query; no account, key, or paid tier is used. Atlas requests up to 20 open binary-market matches sorted by recent volume, then keeps only active MANA-denominated markets with a matching question, positive recent volume, and positive liquidity. MANA is platform play money, not fiat or a real-money asset price. Probability, recent volume, and liquidity are displayed as one platform's self-selected forecast activity; they are not a representative survey, verified probability, national view, or evidence of financial positioning. These records appear only with citations below the conversation overview and are never sent to the AI summarizer. Manifold API documentation permits non-commercial/personal research use and documents a rate limit; this source is excluded if Atlas becomes commercial without a written agreement.",
    },
    {
      name: "GDELT · retired from live search",
      key: "gdelt",
      enabled: false,
      onDemand: false,
      referenceUrl: "https://www.gdeltproject.org/",
      referenceLabel: "GDELT Project",
      detail:
        "Removed from current searches after live requests returned HTTP 429. It is not automatically retried and does not contribute to search results. Historical records, if any, remain subject to the separate source-retention policy.",
    },
    {
      name: "RSS / Atom",
      key: "rss",
      enabled: process.env.RSS_ENABLED === "true" && enabledFeeds(),
      detail: enabledFeeds()
        ? process.env.RSS_ENABLED === "true"
          ? "Optional custom publisher feeds are enabled. Review each publisher’s terms before use. Licensed Global Voices and The Conversation feeds, and the European Commission feed, are listed separately with their own rules and run health."
          : "Custom publisher feed URLs are configured, but this connector is disabled by RSS_ENABLED. Licensed Global Voices and The Conversation feeds, and the European Commission feed, are listed separately with their own rules and run health."
        : "No approved custom publisher feeds are configured for this optional connector. Licensed Global Voices and The Conversation feeds, and the European Commission feed, are listed separately with their own rules and run health. Google News redirect feeds are rejected.",
    },
    {
      name: "Korea MOIS official releases",
      key: "mois-official-policy",
      enabled: process.env.MOIS_PRESS_RELEASES_ENABLED === "true",
      detail:
        "Optional no-key government-policy context, not investor discussion. Each linked article must show the KOGL Type 1 attribution license; only title, source link, and date are retained.",
    },
    {
      name: "Hacker News · retired from visitor search",
      key: "hacker-news",
      enabled: false,
      onDemand: false,
      detail:
        "Retired from live Atlas search because public API access alone did not resolve the content-display and reuse review. It is not queried, included in summaries, or a claim of current coverage. Historical operational data is separate and not surfaced in visitor search.",
      referenceUrl: "https://hn.algolia.com/api",
      referenceLabel: "Hacker News Search API documentation",
      secondaryReferenceUrl: "https://github.com/HackerNews/API",
      secondaryReferenceLabel: "Official Hacker News API documentation",
    },
    {
      name: "Stack Exchange · international Q&A",
      key: "stack-exchange",
      enabled: process.env.STACK_EXCHANGE_ENABLED === "true",
      onDemand: true,
      referenceUrl: "https://api.stackexchange.com/docs/advanced-search",
      referenceLabel: "Official Stack Exchange advanced-search API",
      additionalReferences: [
        { url: "https://api.stackexchange.com/docs/throttle", label: "Official API throttling guidance" },
        { url: "https://stackoverflow.com/help/licensing", label: "Stack Exchange content licensing" },
      ],
      detail:
        "The visitor search queries the public Stack Exchange API for title matches in Economics, Quantitative Finance, and Personal Finance & Money. For the selected Japanese, Brazilian Portuguese, or Spanish lens, it also searches the corresponding public Stack Overflow language community; other selected languages have no configured localized Stack Exchange site. It returns only individually CC BY-SA 4.0 items, with unmodified title, original link, author/profile attribution, site, and license; question and answer bodies are not retrieved. Each provider query is bounded to recent title matches, and terms shorter than 3 or longer than 80 characters are explicitly marked not searched. Matching queries are reused for 65 seconds in the current browser session, and provider backoff instructions are honored; remaining quota is shown when the API reports it. The query is free to call and does not require a paid plan. This is specialist Q&A from one platform operator, not a general forum, independent operators, or representative public opinion; on-demand results are not stored. Scheduled collection is a separate optional feature and not mixed into the visitor search.",
    },
    {
      name: "Reddit · excluded from Atlas research search",
      key: "reddit-public",
      enabled: false,
      onDemand: false,
      referenceUrl: "https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data",
      referenceLabel: "Reddit API access and research restrictions",
      secondaryReferenceUrl: "https://www.redditinc.com/policies/data-api-terms",
      secondaryReferenceLabel: "Reddit Data API Terms",
      detail:
        "Not queried or scraped. Reddit's current developer guidance (reviewed October 2026) says the only official and authorized avenue for research using Reddit data is its Reddit For Researchers program; using the ordinary developer platform or Data API for research violates its policies. The separate free Data API rate allowance does not grant research permission. Atlas would need to qualify for and receive the distinct research-program authorization before using Reddit content, and comply with that program's terms. No Reddit credentials or content are configured.",
    },
    {
      name: "Typst Forum · licensed community discussion",
      key: "typst-forum",
      enabled: true,
      detail:
        "Daily keyless request to the forum's public latest RSS feed. Only titles posted on or after the forum's CC BY 4.0 effective cutoff, named author attribution, date, and original topic link are retained; summaries and post bodies are discarded. This is a narrow software-typesetting community, not financial discussion or a proxy for population opinion. Forum locale is not used to infer language or geography; one operator only.",
    },
    {
      name: "Fedora Discussion · licensed community forum",
      key: "fedora-discussion",
      enabled: true,
      referenceUrl: "https://discussion.fedoraproject.org/tos",
      referenceLabel: "Fedora Discussion terms",
      detail:
        "One daily keyless request to the public Discourse latest-topics endpoint, capped at 30 topics. Fedora Discussion's terms require acceptable contributor licenses and specify CC BY-SA 4.0 as the default. Only the unmodified title, original-poster username for attribution, topic link, latest-activity timestamp, and reply-count snapshot are retained; profile details, post bodies, replies, and topic tags are discarded. This is a selected Fedora/Linux community sample, not financial discussion, broad public opinion, or a proxy for users' geography. The daily endpoint is incomplete and can resurface old topics; activity timestamps do not mean a new topic.",
    },
    {
      name: "Mastodon · public hashtag search",
      key: "mastodon-public",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://docs.joinmastodon.org/client/public/",
      referenceLabel: "Official Mastodon public-data API guidance",
      additionalReferences: [
        { url: "https://docs.joinmastodon.org/methods/timelines/", label: "Official hashtag timeline parameters" },
        { url: "https://joinmastodon.org/servers", label: "Official Mastodon server directory" },
        ...MASTODON_INSTANCES.map(({ host }) => ({ url: `https://${host}/about`, label: `${host} instance policies` })),
      ],
      detail:
        "The current search calls a public hashtag timeline on selected instances, accepting only posts from the last 30 days and up to 20 newest API items for each of up to three separately queried topic tags per instance. For community-focused servers, Atlas passes Mastodon's documented local=true parameter so only statuses hosted on that server are returned; other server timelines may include federated statuses. Server-local posts still do not verify the author's nationality or residence. This is not arbitrary keyword search: untagged posts and posts without those tags are missed, while broad tags can add noise. Korean-, Japanese-, German-, French-, Brazilian Portuguese-, and Spanish-language/community-focused servers are selected for those views; market-specific activity can be sparse, and India has no reviewed local-focused server configured. Public access may be restricted by a server. Excerpts are transient; content warnings suppress previews. Posts from accounts marked as automated remain linkable but are omitted from the AI discussion sample. Detectable link-sharing posts are flagged because linked headlines or copied reporting are not necessarily the poster's independent view. Language and server identity do not establish author location or country opinion. No account or in-app terms affirmation is required; server terms and privacy links are provided below for review.",
    },
    {
      name: "Lemmy · public federated forum view",
      key: "lemmy-public",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://join-lemmy.org/docs/contributors/04-api.html",
      referenceLabel: "Official Lemmy API documentation",
      detail:
        "Visitor-triggered, keyless search of up to 20 newest matching posts on six configured instances: lemmy.world, discuss.tchncs.de, feddit.org, jlai.lu, sopuli.xyz, and sh.itjust.works. The additional live-checked endpoints add Finnish/English and Canadian English/French community-server views, not verified country samples. A short excerpt is shown transiently. Bot-marked, NSFW, removed, stale, future-dated, and unlinked items are filtered. Detectable link-sharing posts are flagged because linked headlines or copied reporting are not necessarily the poster's independent view. Federation can duplicate posts; these are incomplete, overlapping server views, not a global timeline, country proxy, representative population sample, or measure of attention. Posts remain their authors’ content; no blanket license is implied. No account or in-app terms affirmation is required; server terms and privacy links are provided below for review.",
      additionalReferences: LEMMY_INSTANCES.flatMap(({ host, legalUrl, privacyUrl }) => [
        { url: legalUrl, label: `${host} terms` },
        { url: privacyUrl, label: `${host} privacy` },
      ]),
    },
    {
      name: "Wikimedia · article talk pages",
      key: "wikimedia-talk",
      enabled: true,
      onDemand: true,
      detail:
        "Two modes: visitor-triggered, transient topic search across ten language editions; and one daily keyless scheduled sample of up to 500 newest non-bot, non-minor edits to article talk pages per edition. Scheduled records contain only the unchanged page title, timestamp, edition, and exact revision link; comment text, edit summaries, usernames, and IPs are never requested or stored. The linked revision/history supplies attribution under the applicable project license, usually CC BY-SA 4.0 (with GFDL also applying to many text contributions). Edition samples are capped, language is not audience geography, and collaborative editorial activity is not general investor sentiment or a lead by itself.",
    },
    {
      name: "Wikinews · archived, not a live source",
      key: "wikinews-public",
      enabled: false,
      referenceUrl: "https://meta.wikimedia.org/w/index.php?oldid=30328679#Board_of_Trustees_Approves_Closure_of_Wikinews",
      referenceLabel: "Wikimedia Foundation closure notice",
      detail:
        "The Wikimedia Foundation closed all Wikinews editions effective 2026-05-04; they are read-only archives. A live API search returned only 2024 English results, so Atlas removed Wikinews from current-source searches. Archived content is not used as current evidence. See the Wikimedia Foundation’s project-closure announcement and the current distribution list.",
    },
    {
      name: "European Commission Presscorner · official context",
      key: "european-commission-presscorner",
      enabled: true,
      detail:
        "Daily keyless English RSS collection from the European Commission. Only headlines, dates, and original links are retained; attribution is attached under the Commission’s CC BY 4.0 default reuse notice, except items carrying a different notice. This is official institutional context, not independent reporting, public discussion, or a measure of attention.",
    },
    {
      name: "The Conversation · licensed expert analysis",
      key: "the-conversation",
      enabled: true,
      detail:
        "Daily keyless Atom collection from the English Australia, U.S., U.K., Canada, Africa, and New Zealand editions. Each retained feed entry must explicitly carry a Creative Commons attribution/no-derivatives notice. Atlas keeps the unmodified headline, author byline, publication date, original link, edition, and rights notice; summaries and article bodies are discarded. These are editions within one publisher network, not independent outlets or proxies for audience location; this expert analysis is distinct from forum discussion and breaking-news coverage.",
    },
    {
      name: "The Conversation · visitor headline search",
      key: "the-conversation-search",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://theconversation.com/republishing-guidelines",
      referenceLabel: "Publisher republishing and attribution guidance",
      detail:
        "Visitor-triggered search across six first-party English Atom feeds (U.S., U.K., Canada, Australia, New Zealand, and Africa editions), up to five exact headline matches per edition in 30 days. Each returned entry must carry its Creative Commons attribution/no-derivatives feed notice. The route returns only title, author attribution, date, edition, and article URL; any feed excerpt is discarded and never sent to AI. One publisher network's expert analysis is not forum opinion, an independent-source count, or a proxy for contributor/audience geography.",
    },
    {
      name: "Global Voices · international community reporting",
      key: "global-voices",
      enabled: true,
      detail:
        "Daily keyless RSS collection plus on-demand search through the public WordPress API across twelve localized editions: English, Spanish, French, Portuguese, Arabic, Russian, Italian, Dutch, Yoruba, Ukrainian, Greek, and Catalan. On-demand search requests headline metadata and links through a first-party no-store route; Atlas locally requires each meaningful query term to match the returned headline so loose body-only API matches are not presented as relevant headlines. Edition language does not establish author or audience geography. RSS-retained content follows item-level rights checks and attribution; descriptions and story bodies are discarded. Localized editions share one publisher and may include translations; this is reporting, not raw forum discussion, independent outlets, or a representative survey.",
    },
    {
      name: "Bluesky · public conversation search",
      key: "bluesky",
      enabled: true,
      onDemand: true,
      referenceUrl: "https://docs.bsky.app/docs/api/app-bsky-feed-search-posts",
      referenceLabel: "Official Bluesky searchPosts API reference",
      secondaryReferenceUrl: "https://bsky.social/about/support/tos",
      secondaryReferenceLabel: "Bluesky Terms of Service",
      detail:
        "Visitor-triggered search through the public AppView with no API key or account. Up to 25 indexed posts from the last 7 days per phrase. The baseline adds a `lang:en` query filter only when the phrase fits the provider query limit; otherwise it uses the phrase unchanged. The selected lens uses an automatic or researcher-entered local phrase when available, and Atlas displays which phrase was used. Repeated text and byline concentration are flagged without asserting identity or independence. Detectable link-sharing posts are flagged because linked headlines or copied reporting are not necessarily the poster's independent view. Excerpts are transient. Bluesky's terms say users retain their content and grant rights to Bluesky; public API availability is not a blanket content-reuse license to Atlas. Atlas limits itself to transient, attributed excerpts linked to the original, but broader or commercial reuse remains unverified and requires a separate rights review. Language metadata and query language do not establish author location or audience. This is an incomplete platform index, not a representative sample or firehose; access and rate limits may vary.",
    },
    {
      name: "DEV Community · excluded from visitor search",
      key: "dev-community",
      enabled: false,
      onDemand: false,
      detail:
        "Not queried or scraped. The public Forem API provides article and comment endpoints, but DEV's Terms allow only personal, non-commercial, transitory viewing and prohibit public display, copying, or mirroring. Atlas cannot treat API accessibility as permission to show excerpts in a shared research app. Reconsider only if the operator grants compatible written permission or a clear content license is provided.",
      referenceUrl: "https://developers.forem.com/api/v0",
      referenceLabel: "Forem public API documentation",
      secondaryReferenceUrl: "https://dev.to/terms",
      secondaryReferenceLabel: "DEV Community Terms of Use",
    },
    {
      name: "YouTube public comments (candidate)",
      key: "youtube-comments",
      enabled: false,
      detail:
        "Not implemented. Requires a Google API key; the default free quota is limited, API data must be refreshed or deleted within 30 days, and derived analytics require approved use-case terms. Selected video comments are not a representative investor-forum sample.",
    },
    {
      name: "SEC EDGAR",
      key: "sec-edgar",
      enabled: Boolean(process.env.SEC_USER_AGENT),
      onDemand: true,
      detail:
        "Visitor-triggered exact company-name or ticker lookup through SEC issuer metadata and submissions APIs. Free and public with no API key, but Atlas requires the operator's descriptive User-Agent to contain a contact email and uses a server-side request because data.sec.gov does not support browser CORS. Up to 10 recent 10-K, 10-Q, 8-K, 20-F, 40-F, or 6-K filing links from the past three years; only SEC-index metadata is requested, not filing text. This covers SEC registrants—including some foreign issuers—not all global companies; no match is not evidence of absence. Filing links are separate primary-source context, never AI-summary or community-opinion evidence. Per-instance rate limiting and caching are best-effort in serverless hosting.",
      referenceUrl: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces-apis",
      referenceLabel: "SEC EDGAR APIs and data coverage",
      secondaryReferenceUrl: "https://www.sec.gov/developer",
      secondaryReferenceLabel: "SEC developer fair-access guidance",
    },
  ];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const health = await Promise.all(
    sources.map(async (source) => {
      if (!db) return { source, runs: [] as any[], latest: undefined, lastSuccess: undefined, historyCapped: false, historyIncomplete: false };
      const pageSize = 500;
      const maxPages = 10;
      const recent: any[] = [];
      let historyCapped = false;
      let historyIncomplete = false;
      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const { data, error } = await db
          .from("connector_runs")
          .select("id,status,started_at,completed_at,items_stored,metadata_json")
          .eq("connector_name", source.key)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error || !data) {
          historyIncomplete = true;
          break;
        }
        recent.push(...data);
        if (data.length < pageSize) break;
        if (page === maxPages - 1) historyCapped = true;
      }
      const [latestResult, lastSuccessResult] = await Promise.all([
        db
          .from("connector_runs")
          .select("status,started_at,completed_at,items_stored,metadata_json")
          .eq("connector_name", source.key)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("connector_runs")
          .select("status,started_at,completed_at,items_stored,metadata_json")
          .eq("connector_name", source.key)
          .in("status", ["completed", "partial"])
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        source,
        runs: recent,
        latest: latestResult.data ?? undefined,
        lastSuccess: lastSuccessResult.data ?? undefined,
        historyCapped,
        historyIncomplete,
      };
    }),
  );
  return (
    <div className="min-h-screen">
      <SiteHeader action={<Link href="/">← Research desk</Link>} />
      <main className="shell py-16">
        <div className="eyebrow mb-4">Source configuration and health</div>
        <h1 className="mb-4 text-4xl font-extrabold">Sources</h1>
        <p className="mb-10 max-w-2xl leading-7 text-muted">
          The live search separates public conversation from expert, reporting, scholarly, forecast, and SEC filing context. Reddit is excluded from research search under its current developer/API policy. These are incomplete, different kinds of
          evidence—not a representative measure of a country or market.
          Scheduled operational connectors are listed separately below;
          their stored records are not automatically part of this search.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {health.map(({ source, runs, latest, lastSuccess, historyCapped, historyIncomplete }) => {
            const summary = summarizeConnectorRuns(runs);
            const stale =
              !source.onDemand &&
              source.enabled &&
              (!lastSuccess ||
                Date.now() -
                  Date.parse(
                    lastSuccess.completed_at ?? lastSuccess.started_at,
                  ) >
                  48 * 60 * 60 * 1000);
            const status = !source.enabled
              ? "off"
              : source.onDemand
                ? "on demand"
                : stale
                  ? "stale"
                  : latest?.status === "failed"
                    ? "error"
                    : "current";
            return (
              <div className="panel p-6" key={source.name}>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-bold">{source.name}</h2>
                  <span className="mono rounded-full border border-line px-3 py-1 text-[10px] uppercase text-ink">
                    {status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">{source.detail}</p>
                {source.referenceUrl && (
                  <a className="mt-2 inline-block text-xs underline text-muted" href={source.referenceUrl} target="_blank" rel="noreferrer">
                    {source.referenceLabel ?? "Source policy"}
                  </a>
                )}
                {source.secondaryReferenceUrl && (
                  <a className="ml-4 mt-2 inline-block text-xs underline text-muted" href={source.secondaryReferenceUrl} target="_blank" rel="noreferrer">
                    {source.secondaryReferenceLabel ?? "Additional source policy"}
                  </a>
                )}
                {source.additionalReferences?.map((reference) => (
                  <a key={reference.url} className="ml-4 mt-2 inline-block text-xs underline text-muted" href={reference.url} target="_blank" rel="noreferrer">
                    {reference.label}
                  </a>
                ))}
                {source.onDemand ? (
                  <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                    Visitor-triggered only. No database records or automated run-health history.
                  </p>
                ) : <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
                  <dt className="text-muted">Last success</dt>
                  <dd>
                    {lastSuccess
                      ? utc(lastSuccess.completed_at, timeZone)
                      : "none recorded"}
                  </dd>
                  <dt className="text-muted">Latest run result</dt>
                  <dd>
                    {latest
                      ? `${latest.status} · ${latest.items_stored ?? 0} stored · ${utc(latest.started_at, timeZone)}`
                      : "none recorded"}
                  </dd>
                  {source.key === "global-voices" && globalVoicesEditionSummary(latest?.metadata_json) && (
                    <>
                      <dt className="text-muted">Latest edition results</dt>
                      <dd className="col-span-2 leading-5">{globalVoicesEditionSummary(latest?.metadata_json)}</dd>
                    </>
                  )}
                  <dt className="text-muted">Records stored / 24h</dt>
                  <dd>{historyCapped || historyIncomplete ? `at least ${summary.recordsStored}` : summary.recordsStored}</dd>
                  <dt className="text-muted">{source.enabled ? "Run error rate / 24h" : "Recorded run outcomes / 24h · source off"}</dt>
                  <dd>
                    {summary.errorRatePercent === null
                      ? "no runs"
                      : source.enabled
                        ? `${summary.errorRatePercent}% (${summary.unsuccessfulRuns}/${summary.runCount})`
                        : `${summary.unsuccessfulRuns} unsuccessful / ${summary.runCount} recorded`}
                    {historyCapped ? " · history sample capped at 5,000 runs" : historyIncomplete ? " · history query incomplete" : ""}
                  </dd>
                </dl>}
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-xs text-muted">
          Run-health figures cover all fetched records from the previous 24
          hours, up to 5,000 per source. Failed run details are intentionally
          reduced to safe error codes; request URLs, response bodies, and
          credentials are not shown. A source is marked stale after 48 hours
          without a successful run.
        </p>
      </main>
    </div>
  );
}
