"use client";

import { FormEvent, useEffect, useState } from "react";
import { MARKET_COUNTRIES, marketCountry } from "../../lib/market-countries";
import { topicHashtags } from "../../lib/topic-hashtags";
import { LEMMY_INSTANCES } from "../../lib/lemmy-public";
import { runResearchSweep, type ResearchSweepSourceResult } from "../../lib/research-sweep";
import { buildCitationIds, citationKey } from "../../lib/perspective-snapshot";
import { languageTag } from "../../lib/language-tag";
import { collapseRepeatedEvidenceViews, flagRepeatedEvidenceViews, hasMarketSignalTerms, selectBalancedEvidence, type MarketSummary } from "../../lib/market-summary";
import { inspectQueryClarity } from "../../lib/query-clarity";
import { hasMaterialEvidenceContext } from "../../lib/evidence-context";

export default function ResearchSweep({
  initialTopic,
  onSearchTopic,
}: {
  initialTopic: string;
  onSearchTopic: (topic: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [countryCode, setCountryCode] = useState("KR");
  const [localQueryOverride, setLocalQueryOverride] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchedCountryCode, setSearchedCountryCode] = useState("KR");
  const [searchedLocalQuery, setSearchedLocalQuery] = useState("");
  const [localQueryMethod, setLocalQueryMethod] = useState<"researcher" | "translated" | "original" | "baseline">("baseline");
  const [results, setResults] = useState<ResearchSweepSourceResult[]>([]);
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [screenedOutCounts, setScreenedOutCounts] = useState<{ baseline: number; selected: number } | null>(null);
  const [summaryMode, setSummaryMode] = useState<"ai" | "evidence" | "unavailable">("evidence");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const citationIds = buildCitationIds(results);
  const displayResults = collapseRepeatedEvidenceViews(results);
  const searchedCountry = marketCountry(searchedCountryCode);
  const queryClarity = inspectQueryClarity(searchedQuery);

  useEffect(() => {
    if (initialTopic) setQuery(initialTopic);
  }, [initialTopic]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const topic = query.trim();
    void search(topic, localQueryOverride.trim());
  }

  async function search(topic: string, researcherLocalQuery = "", selectedCountryCode = countryCode) {
    const activeCountryCode = selectedCountryCode;
    const activeCountry = marketCountry(activeCountryCode);
    setLoading(true);
    setSearched(true);
    setSearchedQuery(topic);
    setSearchedCountryCode(activeCountryCode);
    setSummary(null);
    setScreenedOutCounts(null);
    setResults([]);
    setError("");
    onSearchTopic(topic);

    try {
      const preparation = activeCountryCode === "US"
        ? { mode: "baseline", query: topic, hashtags: topicHashtags(topic) }
        : researcherLocalQuery
          ? { mode: "researcher", query: researcherLocalQuery, hashtags: topicHashtags(researcherLocalQuery) }
          : await requestMarketAssist({ action: "prepare", topic, country: activeCountryCode, aiEnabled: true });
      const localQuery = preparation.query || topic;
      setSearchedLocalQuery(activeCountryCode === "US" ? topic : localQuery);
      setLocalQueryMethod(preparation.mode === "researcher" ? "researcher" : preparation.mode === "english-fallback" || preparation.mode === "unavailable" ? "original" : activeCountryCode === "US" ? "baseline" : "translated");
      const localHashtags = (preparation.hashtags.length ? preparation.hashtags : topicHashtags(localQuery)).filter(Boolean).slice(0, 3);
      const allLemmy = LEMMY_INSTANCES.map(({ host }) => host);
      const baseMastodon = topicHashtags(topic).map((hashtag) => ({ hashtag, instance: "mastodon.social" as const }));
      const baseSearch = runResearchSweep(topic, {
        globalVoices: false,
        theConversation: true,
        crossref: true,
        openAlex: true,
        arxiv: true,
        manifoldForecasts: true,
        bluesky: true,
        blueskyQueries: [topic.length <= 92 ? `${topic} lang:en` : topic],
        // Keep these specialist Q&A communities as an explicitly separate evidence class.
        stackExchangeQueries: ["economics", "quant", "money"].map((site) => ({ site, query: topic })),
        lemmy: true,
        lemmyInstances: ["lemmy.world"],
        lemmyQueries: [{ host: "lemmy.world", query: topic }],
        mastodonQueries: baseMastodon,
      });

      const localSearch = activeCountryCode !== "US" ? (() => {
        const localLemmyInstances = [...new Set([...activeCountry.lemmyInstances, ...allLemmy])];
        return runResearchSweep(localQuery, {
          globalVoices: true,
          bluesky: true,
          blueskyQueries: [localQuery],
          stackExchangeQueries: (activeCountry.stackExchangeSites ?? []).map((site) => ({ site, query: localQuery })),
          lemmy: true,
          lemmyInstances: localLemmyInstances,
          lemmyLocalInstances: activeCountry.lemmyLocalInstances ?? [],
          lemmyQueries: localLemmyInstances.map((host) => ({ host, query: localQuery })),
          mastodonQueries: activeCountry.mastodonInstances.flatMap((host) =>
            localHashtags.map((hashtag) => ({ hashtag, instance: host })),
          ),
          mastodonLocalInstances: activeCountry.mastodonLocalInstances ?? [],
        });
      })() : Promise.resolve([] as ResearchSweepSourceResult[]);
      const [baseResults, localResults] = await Promise.all([baseSearch, localSearch]);

      const merged = [
        ...baseResults,
        ...localResults.map((result) => ({
          ...result,
          key: `local:${result.key}`,
          label: `${activeCountry.name} language/community lens · ${result.label}`,
          coverageNote: [result.coverageNote, result.key.startsWith("mastodon:")
            ? "Mastodon searches the displayed hashtag, not arbitrary keywords. Up to three topic tags are queried separately; untagged posts and posts without these tags are missed."
            : undefined, preparation.mode === "english-fallback" && activeCountry.language !== "en"
            ? `Automatic ${activeCountry.languageName} query translation was unavailable; this search used the original phrase.`
            : undefined].filter(Boolean).join(" ") || undefined,
        })),
      ];
      const markedResults = flagRepeatedEvidenceViews(merged);
      setResults(markedResults);
      const citations = buildCitationIds(markedResults);
      const baselineResults = markedResults.filter(({ key }) => !key.startsWith("local:") && key !== "global-voices" && !key.startsWith("the-conversation:"));
      const localEvidenceResults = markedResults.filter(({ key }) => key.startsWith("local:") && key !== "local:global-voices" && !key.startsWith("local:the-conversation:"));
      const includedEvidenceKeys = new Set<string>();
      const candidateEvidence = {
        us: selectBalancedEvidence(baselineResults, citations, 8, includedEvidenceKeys),
        local: selectBalancedEvidence(localEvidenceResults, citations, 8, includedEvidenceKeys, searchedCountry.language),
      };
      const evidenceForAi = {
        us: candidateEvidence.us.filter(hasMarketSignalTerms),
        local: candidateEvidence.local.filter(hasMarketSignalTerms),
      };
      setScreenedOutCounts({
        baseline: candidateEvidence.us.length - evidenceForAi.us.length,
        selected: candidateEvidence.local.length - evidenceForAi.local.length,
      });
      const generated = (evidenceForAi.us.length > 0 || evidenceForAi.local.length > 0)
        ? await requestMarketAssist({ action: "summarize", topic, country: activeCountryCode, evidence: evidenceForAi, aiEnabled: true })
        : { mode: "unavailable", query: "", hashtags: [], summary: null };
      if (generated.mode === "ai" && generated.summary) {
        setSummary(activeCountryCode === "US" ? sameCountrySummary(generated.summary) : generated.summary);
        setSummaryMode("ai");
      } else {
        setSummary(buildEvidenceSummary(evidenceForAi.us, evidenceForAi.local, activeCountry.name, activeCountryCode === "US", generated.reason));
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
        <div className="market-country-control">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="market-globe-icon"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M5.6 6.5h12.8M5.6 17.5h12.8" /></svg>
          <label className="sr-only" htmlFor="market-country">Language and community lens</label>
          <select id="market-country" className="market-country-select" value={countryCode} onChange={(event) => { setCountryCode(event.target.value); setLocalQueryOverride(""); }}>
            {MARKET_COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
          </select>
        </div>
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
        <button className="btn market-search-button" type="submit" aria-label={loading ? "Searching" : "Search"} disabled={loading}>
          {loading ? <span className="market-search-loading-label">…</span> : <svg aria-hidden="true" viewBox="0 0 20 20" className="market-search-icon"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>}
        </button>
      </form>

      <p className="market-attribution">By: <a href="https://www.linkedin.com/in/arnavsharma0727/" target="_blank" rel="noreferrer">Arnav Sharma UVA30’</a></p>

      {searched && !loading && <>
        <p className="country-lens-note">Selected lens: {searchedCountry.name} · {searchedCountry.languageName} language/community. Local query used: “{searchedLocalQuery}” ({localQueryMethod === "researcher" ? "entered by you" : localQueryMethod === "translated" ? "automatically translated; review it below" : localQueryMethod === "original" ? "original phrase; translation unavailable" : "same baseline phrase"}). This does not verify poster location or represent a national sample.</p>
        {searchedCountryCode !== "US" && <form className="local-query-refinement" onSubmit={(event) => { event.preventDefault(); void search(searchedQuery, localQueryOverride.trim(), searchedCountryCode); }}>
          <label htmlFor="local-query-override">Prefer a specific {searchedCountry.languageName} search phrase?</label>
          <div><input id="local-query-override" value={localQueryOverride} onChange={(event) => setLocalQueryOverride(event.target.value)} maxLength={100} placeholder={`Optional phrase in ${searchedCountry.languageName}`} /><button type="submit" disabled={loading || !localQueryOverride.trim()}>Search this phrase</button></div>
          <small>When provided, this phrase replaces automatic translation for text-query sources; Mastodon converts it to a hashtag. Clear it to return to automatic translation.</small>
        </form>}
      </>}
      {searched && loading && <div className="search-loading" role="status"><span className="search-spinner" aria-hidden="true" /> Searching live public sources{searchedCountryCode === "US" ? "" : ` and preparing the ${searchedCountry.name} language/community comparison`} for <strong>“{searchedQuery}”</strong>…</div>}
      {error && <p role="alert" className="search-error">{error}</p>}
      {searched && !loading && !error && summary && (
        <div className="market-results">
          <div className="market-results-heading">
            <div>
              <p className="eyebrow">Live conversation search</p>
              <h2>{searchedCountryCode === "US"
                ? `“${searchedQuery}” · English-language baseline search`
                : `“${searchedQuery}” · baseline search vs ${searchedCountry.name} language/community lens`}</h2>
            </div>
            <p>Each source, query, time window, and availability status is listed below.</p>
          </div>
          {queryClarity.warning && <aside className="query-clarity-note" aria-live="polite">
            <p>{queryClarity.warning}</p>
            {queryClarity.suggestedAlias && <button type="button" onClick={() => {
              setLocalQueryOverride("");
              setQuery(queryClarity.suggestedAlias!);
              void search(queryClarity.suggestedAlias!, "", searchedCountryCode);
            }}>Run a new search for “{queryClarity.suggestedAlias}”</button>}
          </aside>}

          <section className="market-summary" aria-labelledby="market-summary-title">
            <header>
              <div>
                <p className="eyebrow">{summaryMode === "ai" ? "AI-generated from public discussion excerpts" : summaryMode === "unavailable" ? "AI unavailable · evidence overview" : "Evidence overview · AI not used"}</p>
                <h3 id="market-summary-title">Selected public conversation</h3>
              </div>
                <span>{summaryMode === "ai" ? "AI summary" : summaryMode === "unavailable" ? "AI unavailable" : "Local overview"}</span>
            </header>
            <div className="market-summary-columns">
              <article>
                <h4>Baseline search · language varies by provider</h4>
                <p><SummaryPassageText passage={summary.usSummary} /></p>
              </article>
              <article>
                <h4>{searchedCountry.name} selection · {searchedCountry.languageName} search lens</h4>
                <p><SummaryPassageText passage={summary.localSummary} /></p>
              </article>
            </div>
            <article className="market-summary-comparison">
              <h4>Comparison</h4>
              <p><SummaryPassageText passage={summary.comparison} /></p>
            </article>
            <p className="market-summary-caveat">Summary scope: at most eight short public discussion excerpts per side. Title-only expert Q&amp;A, reporting, and publisher-analysis headlines listed below are not sent to the summarizer.</p>
            <p className="market-summary-caveat">AI input: {screenedOutCounts?.baseline ?? 0} baseline and {screenedOutCounts?.selected ?? 0} selected-lens excerpts were excluded by a conservative market-language screen. This screen can miss relevant posts and does not itself prove relevance.</p>
            <p className="market-summary-caveat">For the selected-language overview, records with provider-reported language that clearly differs from the selected language are left out of AI input but remain visible below. Missing or instance-specific language labels cannot be verified.</p>
            <p className="market-summary-caveat">The baseline is not a U.S. sample and may include mixed languages. Bluesky receives an English-language filter only when the query fits the provider limit; Lemmy uses the phrase shown for each provider, and Mastodon searches the displayed hashtag. The selected lens is not verified poster nationality or a representative national sample. Counts are API returns, not attention, prevalence, or investor positioning.</p>
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
              {displayResults.map((view, index) => <SourceResults key={`${view.result.key}:${index}`} result={view.result} evidence={view.evidence} returnedCount={view.returnedCount} duplicateCount={view.duplicateCount} citationIds={citationIds} />)}
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
    const body = await response.json() as { mode?: string; query?: string; hashtags?: string[]; summary?: MarketSummary; reason?: string };
    if (!response.ok) return { mode: "unavailable", query: body.query ?? "", hashtags: body.hashtags ?? [], summary: null, reason: body.reason ?? (response.status === 429 ? "request-limited" : "provider-error") };
    return { mode: body.mode, query: body.query ?? "", hashtags: body.hashtags ?? [], summary: body.summary ?? null, ...(body.reason ? { reason: body.reason } : {}) };
  } catch {
    return { mode: "unavailable", query: input.action === "prepare" ? input.topic : "", hashtags: input.action === "prepare" ? topicHashtags(input.topic) : [], summary: null, reason: "network-error" };
  }
}

function buildEvidenceSummary(us: ReturnType<typeof selectBalancedEvidence>, local: ReturnType<typeof selectBalancedEvidence>, country: string, sameCountry: boolean, failureReason?: string): MarketSummary {
  const summarize = (items: ReturnType<typeof selectBalancedEvidence>, label: string) => items.length
    ? { text: `This evidence overview does not infer a shared opinion; inspect the selected ${label} records below.`, citations: items.slice(0, 3).map(({ citationId }) => citationId) }
    : { text: `No excerpts passed Atlas’s conservative market-language screen for this ${label} overview. Matching source records remain below; the screen can miss relevant discussion, and this is not evidence that discussion is absent.`, citations: [] };
  return {
    usSummary: summarize(us, "baseline search"),
    localSummary: sameCountry
      ? { text: "The baseline selection is active, so this repeats the same search—not a second view.", citations: [] }
      : summarize(local, `${country} language/community lens`),
    comparison: sameCountry
      ? { text: "No separate country-lens search was run for this query.", citations: [] }
      : { text: "Provider coverage, language, and communities differ, so these results are not like-for-like national samples. Read the original records and source limitations before interpreting any contrast.", citations: [...us, ...local].slice(0, 4).map(({ citationId }) => citationId) },
    limitations: ["This is a free, rule-based evidence overview—not an AI-generated synthesis or representative opinion poll.", ...(failureReason ? [aiFailureMessage(failureReason)] : [])],
  };
}

function aiFailureMessage(reason: string) {
  switch (reason) {
    case "disabled": return "AI summaries are not enabled or configured by the operator; this local overview remains available.";
    case "rate-limited": return "The free AI provider reported a usage limit; this local overview is shown instead.";
    case "request-limited": return "Atlas's AI request limit was reached; this local overview is shown instead.";
    case "timeout": return "The AI provider did not respond in time; this local overview is shown instead.";
    case "citation-validation": return "The AI response did not pass Atlas citation checks; this local overview is shown instead.";
    case "invalid-response": return "The AI provider returned an unusable response; this local overview is shown instead.";
    case "network-error": return "Atlas could not reach the AI provider; this local overview is shown instead.";
    default: return "The AI provider is temporarily unavailable; this local overview is shown instead.";
  }
}

function sameCountrySummary(summary: MarketSummary): MarketSummary {
  return {
    ...summary,
    localSummary: { text: "The baseline selection is active; this repeats the same search, not a second lens.", citations: [] },
    comparison: { text: "No separate country-language comparison was run.", citations: [] },
  };
}

function SummaryPassageText({ passage }: { passage: MarketSummary["usSummary"] }) {
  // Keep the overview readable; citation IDs remain attached to the validated
  // passage and are presented together in the source register below.
  return <>{passage.text}</>;
}

function SourceResults({ result, evidence, returnedCount, duplicateCount, citationIds }: { result: ResearchSweepSourceResult; evidence: ResearchSweepSourceResult["evidence"]; returnedCount: number; duplicateCount: number; citationIds: Map<string, string> }) {
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? evidence : evidence.slice(0, 8);
  return (
    <section className="source-results" aria-label={result.label}>
      <header>
        <h3>{result.label}</h3>
        <span className={result.status === "unavailable" ? "source-count source-count--error" : result.status === "not-searched" ? "source-count source-count--muted" : "source-count"}>{result.status === "unavailable" ? "Unavailable" : result.status === "not-searched" ? "Not searched" : result.status === "partial" ? "Partial coverage" : duplicateCount ? `${evidence.length} unique · ${returnedCount} returned` : `${returnedCount} returned`}</span>
      </header>
      <p className="source-window">{result.window}</p>
      <p className="source-query-meta">Query: <q>{result.query}</q> · Started {new Date(result.asOf).toLocaleString()} local time · Retrieved {new Date(result.retrievedAt ?? result.asOf).toLocaleString()} local time</p>
      {result.coverageNote && <p className="source-coverage-warning" role="status">{result.coverageNote}</p>}
      {result.sourceNote && <p className="source-coverage-warning" role="status">{result.sourceNote}</p>}
      {result.error ? (
        <p className="source-empty">{result.status === "not-searched" ? result.error : result.status === "unavailable" ? `${result.error} Other sources can still return results.` : result.error}</p>
      ) : evidence.length ? (
        <>
          <ul>{items.map((item) => (
            <li key={item.id} id={`citation-${citationIds.get(citationKey(result.key, item.id))}`}>
              <span className="source-citation-ref">{citationIds.get(citationKey(result.key, item.id))}</span>
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
              {(item.evidenceClass === "crowd forecast" || hasMaterialEvidenceContext(item.context)) && <p className={item.evidenceClass === "crowd forecast" ? "source-context-note source-context-note--forecast" : "source-context-note"}>{item.context}</p>}
              {item.transientPreview && <p className="source-preview" lang={languageTag(item.language)}>{compactPreview(item.transientPreview)}</p>}
              <p className="source-meta">{item.evidenceClass} · {item.source} · {item.language} · {item.timeLabel.toLowerCase()} <time dateTime={item.timeValue}>{new Date(item.timeValue).toISOString().replace("T", " ").replace(".000Z", " UTC")}</time></p>
              {item.attribution && <p className="source-meta">Attribution: {item.attributionUrl
                ? <a href={item.attributionUrl} target="_blank" rel="noreferrer">{item.attribution}</a>
                : item.attribution}{item.licenseName && <> · License: {item.licenseUrl
                  ? <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.licenseName}</a>
                  : item.licenseName}</>}</p>}
            </li>
          ))}</ul>
          {evidence.length > items.length && <button className="show-more-results" type="button" onClick={() => setShowAll(true)}>Show all {evidence.length} unique results</button>}
        </>
      ) : returnedCount > 0 ? (
        <p className="source-empty">All {returnedCount} returned {returnedCount === 1 ? "record also appeared" : "records also appeared"} in another selected view. Repeated appearances are one original record, not independent corroboration.</p>
      ) : (
        <div className="source-empty"><span className="source-empty-mark" aria-hidden="true">↗</span><div><strong>Search completed · no matching records returned</strong><p>Try another phrase or query lens. An empty result does not mean the topic is absent from this source.</p></div></div>
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
