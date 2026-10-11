"use client";

import { FormEvent, useEffect, useState } from "react";
import { MARKET_COUNTRIES, marketCountry } from "../../lib/market-countries";
import { LEMMY_INSTANCES } from "../../lib/lemmy-public";
import { runResearchSweep, type ResearchSweepSourceResult } from "../../lib/research-sweep";
import { buildCitationIds, citationKey } from "../../lib/perspective-snapshot";
import { languageTag } from "../../lib/language-tag";
import { flagRepeatedEvidenceViews, selectBalancedEvidence, type MarketSummary } from "../../lib/market-summary";

export default function ResearchSweep({
  initialTopic,
  onSearchTopic,
}: {
  initialTopic: string;
  onSearchTopic: (topic: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [countryCode, setCountryCode] = useState("KR");
  const [results, setResults] = useState<ResearchSweepSourceResult[]>([]);
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [summaryMode, setSummaryMode] = useState<"ai" | "evidence" | "unavailable">("evidence");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const citationIds = buildCitationIds(results);
  const country = marketCountry(countryCode);

  useEffect(() => {
    if (initialTopic) setQuery(initialTopic);
  }, [initialTopic]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const topic = query.trim();
    void search(topic);
  }

  async function search(topic: string) {
    setLoading(true);
    setSearched(true);
    setSummary(null);
    setResults([]);
    setError("");
    onSearchTopic(topic);

    try {
      const preparation = await requestMarketAssist({ action: "prepare", topic, country: countryCode, aiEnabled: true });
      const localQuery = preparation.query || topic;
      const localHashtags = (preparation.hashtags.length ? preparation.hashtags : [hashtagFromTopic(localQuery)]).filter(Boolean);
      const allLemmy = LEMMY_INSTANCES.map(({ host }) => host);
      const englishHashtag = hashtagFromTopic(topic);
      const baseMastodon = englishHashtag ? [{ hashtag: englishHashtag, instance: "mastodon.social" as const }] : [];
      const baseSearch = runResearchSweep(topic, {
        globalVoices: false,
        bluesky: true,
        blueskyQueries: [topic.length <= 92 ? `${topic} lang:en` : topic],
        lemmy: true,
        lemmyInstances: ["lemmy.world"],
        lemmyQueries: [{ host: "lemmy.world", query: topic }],
        mastodonQueries: baseMastodon,
      });

      const localSearch = countryCode !== "US" ? (() => {
        const localLemmyInstances = [...new Set([...country.lemmyInstances, ...allLemmy])];
        return runResearchSweep(localQuery, {
          globalVoices: true,
          bluesky: true,
          blueskyQueries: [localQuery],
          lemmy: true,
          lemmyInstances: localLemmyInstances,
          lemmyQueries: localLemmyInstances.map((host) => ({ host, query: localQuery })),
          mastodonQueries: country.mastodonInstances.flatMap((host, index) => {
            const hashtag = localHashtags[index % localHashtags.length];
            return hashtag ? [{ hashtag, instance: host }] : [];
          }),
        });
      })() : Promise.resolve([] as ResearchSweepSourceResult[]);
      const [baseResults, localResults] = await Promise.all([baseSearch, localSearch]);

      const merged = [
        ...baseResults,
        ...localResults.map((result) => ({
          ...result,
          key: `local:${result.key}`,
          label: `${country.name} lens · ${result.label}`,
          coverageNote: [result.coverageNote, result.key.startsWith("mastodon:")
            ? "Mastodon searches the hashtag shown, not arbitrary keywords. Atlas mechanically formats the entered phrase as that tag; untagged posts are missed."
            : undefined, preparation.mode === "english-fallback" && country.language !== "en"
            ? `Automatic ${country.languageName} query translation was unavailable; this search used the original phrase.`
            : undefined].filter(Boolean).join(" ") || undefined,
        })),
      ];
      const markedResults = flagRepeatedEvidenceViews(merged);
      setResults(markedResults);
      const citations = buildCitationIds(markedResults);
      const baselineResults = markedResults.filter(({ key }) => !key.startsWith("local:") && key !== "global-voices");
      const localEvidenceResults = markedResults.filter(({ key }) => key.startsWith("local:") && key !== "local:global-voices");
      const includedEvidenceKeys = new Set<string>();
      const evidenceForAi = {
        us: selectBalancedEvidence(baselineResults, citations, 8, includedEvidenceKeys),
        local: selectBalancedEvidence(localEvidenceResults, citations, 8, includedEvidenceKeys),
      };
      const generated = (evidenceForAi.us.length > 0 || evidenceForAi.local.length > 0)
        ? await requestMarketAssist({ action: "summarize", topic, country: countryCode, evidence: evidenceForAi, aiEnabled: true })
        : { mode: "unavailable", query: "", hashtags: [], summary: null };
      if (generated.mode === "ai" && generated.summary) {
        setSummary(countryCode === "US" ? sameCountrySummary(generated.summary) : generated.summary);
        setSummaryMode("ai");
      } else {
        setSummary(buildEvidenceSummary(evidenceForAi.us, evidenceForAi.local, country.name, countryCode === "US"));
        setSummaryMode("unavailable");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The search could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`market-search ${searched ? "market-search--results" : "market-search--landing"}`} aria-label="Search global market conversations">
      {searched && <h1 id="search-title" className="sr-only">Search results for {query}</h1>}

      <form id="market-query-form" onSubmit={submit} className={`market-search-form ${searched ? "market-search-form--compact" : ""}`}>
        <label className="sr-only" htmlFor="market-query">Search a market interest</label>
        <input
          id="market-query"
          className="market-query-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          maxLength={100}
          placeholder="Search a market, company, or idea"
          autoComplete="off"
          required
        />
        <label className="sr-only" htmlFor="market-country">Country language lens</label>
        <select id="market-country" className="market-country-select" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
          {MARKET_COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
        </select>
        <button className="btn btn-primary market-search-button" type="submit" disabled={loading}>
          {!loading && <svg aria-hidden="true" viewBox="0 0 20 20" className="market-search-icon"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>}
          <span>{loading ? "Searching…" : "Search"}</span>
        </button>
      </form>

      <p className="market-attribution">By: <a href="https://www.linkedin.com/in/arnavsharma0727/" target="_blank" rel="noreferrer">Arnav Sharma UVA30’</a></p>
      <div className="search-data-note">
        <span>Search automatically creates an AI summary when available. The topic and up to 16 short public excerpts are sent to Groq; source links and author handles are excluded. AI may be unavailable if the operator has not enabled it or free usage limits are reached. <a href="/privacy">Privacy details</a>.</span>
        <nav className="search-policy-links" aria-label="Search and data policies">
          <a href="/sources">Sources</a><a href="/methodology">Methodology</a><a href="/privacy">Privacy</a>
        </nav>
      </div>

      {searched && !loading && <p className="country-lens-note">Country lens: {country.name} · {country.languageName} communities, using the phrase as entered. Enter it in {country.languageName} for better local-language matches. Server or language does not verify a poster&apos;s location.</p>}
      {searched && loading && <div className="search-loading" role="status"><span className="search-spinner" aria-hidden="true" /> Searching live public sources and preparing the {country.name} comparison for <strong>“{query}”</strong>…</div>}
      {error && <p role="alert" className="search-error">{error}</p>}
      {searched && !loading && !error && summary && (
        <div className="market-results">
          <div className="market-results-heading">
            <div>
              <p className="eyebrow">Live conversation search</p>
              <h2>“{query}” · English-language baseline vs {country.name} language/community lens</h2>
            </div>
            <p>Each source, query, time window, and availability status is listed below.</p>
          </div>

          <section className="market-summary" aria-labelledby="market-summary-title">
            <header>
              <div>
                <p className="eyebrow">{summaryMode === "ai" ? "AI-generated from retrieved evidence" : summaryMode === "unavailable" ? "AI unavailable · evidence overview" : "Evidence overview · AI not used"}</p>
                <h3 id="market-summary-title">Selected public conversation</h3>
              </div>
                <span>{summaryMode === "ai" ? "AI summary" : summaryMode === "unavailable" ? "AI unavailable" : "Local overview"}</span>
            </header>
            <div className="market-summary-columns">
              <article>
                <h4>United States · English-language baseline</h4>
                <p><SummaryPassageText passage={summary.usSummary} /></p>
              </article>
              <article>
                <h4>{country.name} · {country.languageName} search lens</h4>
                <p><SummaryPassageText passage={summary.localSummary} /></p>
              </article>
            </div>
            <article className="market-summary-comparison">
              <h4>Comparison</h4>
              <p><SummaryPassageText passage={summary.comparison} /></p>
            </article>
            <p className="market-summary-caveat">The English-language baseline is not verified U.S. residents; only its Bluesky query is explicitly language-filtered. Lemmy uses the phrase as entered, and Mastodon searches the displayed hashtag. The selected country is a language/community lens, not verified poster nationality or a representative national sample. Counts are API returns, not attention, prevalence, or investor positioning.</p>
            {!!summary.limitations.length && <ul className="market-summary-limitations">{summary.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
          </section>

          <section className="source-citations" aria-labelledby="source-citations-title">
            <header>
              <div>
                <p className="eyebrow">Evidence</p>
                <h3 id="source-citations-title">Sources &amp; citations</h3>
              </div>
              <p>Original links and provider-specific coverage, collected below the summary.</p>
            </header>
            <div className="market-results-grid">
              {results.map((result) => <SourceResults key={result.key} result={result} citationIds={citationIds} />)}
            </div>
          </section>
          <p className="search-limits">Public API results are incomplete samples. They can omit content, overlap across federated servers, and reflect platform/language selection. An AI summary describes only the retrieved sample; inspect original sources before drawing conclusions. <a href="/sources">How sources work</a> · <a href="/privacy">Privacy</a>.</p>
        </div>
      )}
    </section>
  );
}

async function requestMarketAssist(input: { action: "prepare"; topic: string; country: string; aiEnabled: true } | { action: "summarize"; topic: string; country: string; aiEnabled: true; evidence: { us: ReturnType<typeof selectBalancedEvidence>; local: ReturnType<typeof selectBalancedEvidence> } }) {
  try {
    const response = await fetch("/api/research/market-assist", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const body = await response.json() as { mode?: string; query?: string; hashtags?: string[]; summary?: MarketSummary };
    if (!response.ok) throw new Error("AI summary unavailable");
    return { mode: body.mode, query: body.query ?? "", hashtags: body.hashtags ?? [], summary: body.summary ?? null };
  } catch {
    return { mode: "unavailable", query: input.action === "prepare" ? input.topic : "", hashtags: input.action === "prepare" ? [hashtagFromTopic(input.topic)] : [], summary: null };
  }
}

function buildEvidenceSummary(us: ReturnType<typeof selectBalancedEvidence>, local: ReturnType<typeof selectBalancedEvidence>, country: string, sameCountry: boolean): MarketSummary {
  const summarize = (items: ReturnType<typeof selectBalancedEvidence>, label: string) => items.length
    ? { text: `This evidence overview does not infer a shared opinion; inspect the selected ${label} records below.`, citations: items.slice(0, 3).map(({ citationId }) => citationId) }
    : { text: `No text-bearing records were selected for this ${label} overview. Check each source status below; an empty sample does not show that discussion is absent.`, citations: [] };
  return {
    usSummary: summarize(us, "English-language baseline"),
    localSummary: sameCountry
      ? { text: "The United States is selected, so this is the same English-language baseline—not a second view.", citations: [] }
      : summarize(local, `${country} language/community lens`),
    comparison: sameCountry
      ? { text: "No separate country-lens search was run for this query.", citations: [] }
      : { text: "Provider coverage, language, and communities differ, so these results are not like-for-like national samples. Read the original records and source limitations before interpreting any contrast.", citations: [...us, ...local].slice(0, 4).map(({ citationId }) => citationId) },
    limitations: ["This is a free, rule-based evidence overview—not an AI-generated synthesis or representative opinion poll."],
  };
}

function sameCountrySummary(summary: MarketSummary): MarketSummary {
  return {
    ...summary,
    localSummary: { text: "The United States is selected; this repeats the English-language baseline, not a second search.", citations: [] },
    comparison: { text: "No separate country-language comparison was run.", citations: [] },
  };
}

function SummaryPassageText({ passage }: { passage: MarketSummary["usSummary"] }) {
  return <>{passage.text}{passage.citations.map((id) => <a key={id} className="overview-citation-ref" href={`#citation-${id}`} aria-label={`Open supporting source ${id}`}>{id}</a>)}</>;
}

function hashtagFromTopic(topic: string) {
  const hashtag = topic.trim().split(/\s+/).map((part) => part.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean).map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1)).join("").slice(0, 50);
  return /^[\p{L}\p{N}_-]{1,50}$/u.test(hashtag) ? hashtag : "";
}

function SourceResults({ result, citationIds }: { result: ResearchSweepSourceResult; citationIds: Map<string, string> }) {
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? result.evidence : result.evidence.slice(0, 8);
  return (
    <section className="source-results" aria-label={result.label}>
      <header>
        <h3>{result.label}</h3>
        <span className={result.status === "unavailable" ? "source-count source-count--error" : result.status === "not-searched" ? "source-count source-count--muted" : "source-count"}>{result.status === "unavailable" ? "Unavailable" : result.status === "not-searched" ? "Not searched" : result.status === "partial" ? "Partial coverage" : `${result.evidence.length} returned`}</span>
      </header>
      <p className="source-window">{result.window}</p>
      <p className="source-query-meta">Query: <q>{result.query}</q> · Started {new Date(result.asOf).toLocaleString()} local time · Retrieved {new Date(result.retrievedAt ?? result.asOf).toLocaleString()} local time</p>
      {result.coverageNote && <p className="source-coverage-warning" role="status">{result.coverageNote}</p>}
      {result.sourceNote && <p className="source-coverage-warning" role="status">{result.sourceNote}</p>}
      {result.error ? (
        <p className="source-empty">This source is temporarily unavailable. Other sources can still return results.</p>
      ) : result.evidence.length ? (
        <>
          <ul>{items.map((item) => (
            <li key={item.id} id={`citation-${citationIds.get(citationKey(result.key, item.id))}`}>
              <span className="source-citation-ref">{citationIds.get(citationKey(result.key, item.id))}</span>
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
              {(item.context?.includes("Preview withheld") || item.context?.includes("Identical normalized text") || item.context?.includes("query/server views")) && <p className="source-context-note">{item.context}</p>}
              {item.transientPreview && <p className="source-preview" lang={languageTag(item.language)}>{compactPreview(item.transientPreview)}</p>}
              <p className="source-meta">{item.source} · {item.language} · {item.timeLabel.toLowerCase()} <time dateTime={item.timeValue}>{new Date(item.timeValue).toISOString().replace("T", " ").replace(".000Z", " UTC")}</time></p>
            </li>
          ))}</ul>
          {result.evidence.length > items.length && <button className="show-more-results" type="button" onClick={() => setShowAll(true)}>Show all {result.evidence.length} results</button>}
        </>
      ) : (
        <div className="source-empty"><span className="source-empty-mark" aria-hidden="true">↗</span><div><strong>No matches this time</strong><p>Try another phrase or country language lens. No matches here does not mean the topic is absent.</p></div></div>
      )}
    </section>
  );
}

function compactPreview(value: string) {
  const limit = 420;
  if (value.length <= limit) return value;
  const boundary = value.lastIndexOf(" ", limit);
  return `${value.slice(0, boundary > 280 ? boundary : limit).trimEnd()}…`;
}
