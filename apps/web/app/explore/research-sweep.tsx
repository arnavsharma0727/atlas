"use client";

import { FormEvent, useEffect, useState } from "react";
import { MARKET_COUNTRIES, marketCountry } from "../../lib/market-countries";
import { LEMMY_INSTANCES } from "../../lib/lemmy-public";
import { runResearchSweep, ResearchSweepSourceResult } from "../../lib/research-sweep";
import { buildCitationIds, citationKey } from "../../lib/perspective-snapshot";
import { languageTag } from "../../lib/language-tag";

type MarketSummary = { usSummary: string; localSummary: string; comparison: string; limitations: string[] };

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
  const [summaryMode, setSummaryMode] = useState<"ai" | "evidence">("evidence");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiConsent, setAiConsent] = useState(false);
  const citationIds = buildCitationIds(results);
  const country = marketCountry(countryCode);

  useEffect(() => {
    if (initialTopic) setQuery(initialTopic);
  }, [initialTopic]);

  useEffect(() => {
    try {
      setAiConsent(window.localStorage.getItem("atlas-ai-summary-opt-in-v1") === "true");
    } catch {
      // Keep AI summaries opt-in when browser storage is unavailable.
    }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const topic = query.trim();
    void search(topic, aiConsent);
  }

  function changeAiConsent(enabled: boolean) {
    setAiConsent(enabled);
    try {
      window.localStorage.setItem("atlas-ai-summary-opt-in-v1", String(enabled));
    } catch {
      // The choice still applies to this page session.
    }
  }

  async function search(topic: string, allowAi: boolean) {
    setLoading(true);
    setSearched(true);
    setSummary(null);
    setResults([]);
    setError("");
    onSearchTopic(topic);

    try {
      const preparation = allowAi
        ? await requestMarketAssist({ action: "prepare", topic, country: countryCode, aiConsent: true })
        : { query: topic, hashtags: [hashtagFromTopic(topic)], mode: "english-fallback", summary: null };
      const localQuery = preparation.query || topic;
      const localHashtags = (preparation.hashtags.length ? preparation.hashtags : [hashtagFromTopic(localQuery)]).filter(Boolean);
      const allLemmy = LEMMY_INSTANCES.map(({ host }) => host);
      const englishHashtag = hashtagFromTopic(topic);
      const baseMastodon = englishHashtag ? [{ hashtag: englishHashtag, instance: "mastodon.social" as const }] : [];
      const baseSearch = runResearchSweep(topic, {
        hackerNews: true,
        globalVoices: false,
        bluesky: true,
        blueskyQueries: [topic.length <= 92 ? `${topic} lang:en` : topic],
        lemmy: true,
        lemmyInstances: ["lemmy.world"],
        lemmyQueries: [{ host: "lemmy.world", query: topic }],
        lemmyTermsAccepted: true,
        mastodonQueries: baseMastodon,
        mastodonTermsAccepted: true,
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
          lemmyTermsAccepted: true,
          mastodonQueries: country.mastodonInstances.flatMap((host, index) => {
            const hashtag = localHashtags[index % localHashtags.length];
            return hashtag ? [{ hashtag, instance: host }] : [];
          }),
          mastodonTermsAccepted: true,
        });
      })() : Promise.resolve([] as ResearchSweepSourceResult[]);
      const [baseResults, localResults] = await Promise.all([baseSearch, localSearch]);

      const merged = [
        ...baseResults,
        ...localResults.map((result) => ({
          ...result,
          key: `local:${result.key}`,
          label: `${country.name} lens · ${result.label}`,
          coverageNote: [result.coverageNote, preparation.mode === "english-fallback" && country.language !== "en"
            ? `Automatic ${country.languageName} query translation was unavailable; this search used the original phrase.`
            : undefined].filter(Boolean).join(" ") || undefined,
        })),
      ];
      setResults(merged);
      const baselineEvidence = merged.filter(({ key }) => !key.startsWith("local:")).flatMap(({ evidence }) => evidence);
      const localEvidence = merged.filter(({ key }) => key.startsWith("local:") && key !== "local:global-voices").flatMap(({ evidence }) => evidence);
      const evidenceForAi = {
        us: baselineEvidence.slice(0, 8).map((item) => ({ source: item.source, title: item.title, excerpt: (item.transientPreview ?? item.title).slice(0, 300), language: item.language })),
        local: localEvidence.slice(0, 8).map((item) => ({ source: item.source, title: item.title, excerpt: (item.transientPreview ?? item.title).slice(0, 300), language: item.language })),
      };
      const generated = allowAi
        ? await requestMarketAssist({ action: "summarize", topic, country: countryCode, evidence: evidenceForAi, aiConsent: true })
        : { mode: "unavailable", query: "", hashtags: [], summary: null };
      if (generated.mode === "ai" && generated.summary) {
        setSummary(generated.summary);
        setSummaryMode("ai");
      } else {
        setSummary(buildEvidenceSummary(baselineEvidence, localEvidence, country.name, countryCode === "US"));
        setSummaryMode("evidence");
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
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <p className="market-attribution">By: Arnav Sharma UVA30&apos;</p>
      <div className="search-data-note">
        <label className="search-ai-toggle">
          <input type="checkbox" checked={aiConsent} onChange={(event) => changeAiConsent(event.target.checked)} />
          <span>AI summary</span>
        </label>
        <span>{aiConsent ? "Topic goes to public search APIs; AI also sends up to 16 short excerpts to Groq. No source links or author handles." : "Topic goes to public search APIs; the overview is assembled locally."}</span>
        <a href="/sources">Sources &amp; data use</a>
      </div>

      {searched && !loading && <p className="country-lens-note">Country lens: {country.name} · {country.languageName} communities, using the phrase as entered. Enter it in {country.languageName} for better local-language matches. Server or language does not verify a poster&apos;s location.</p>}
      {searched && loading && <div className="search-loading" role="status"><span className="search-spinner" aria-hidden="true" /> Searching live public sources and preparing the {country.name} comparison for <strong>“{query}”</strong>…</div>}
      {error && <p role="alert" className="search-error">{error}</p>}
      {searched && !loading && !error && summary && (
        <div className="market-results">
          <div className="market-results-heading">
            <div>
              <p className="eyebrow">Live conversation search</p>
              <h2>“{query}” · United States and {country.name}</h2>
            </div>
            <p>{results.reduce((count, item) => count + item.evidence.length, 0)} matching records · sources listed below</p>
          </div>

          <section className="market-summary" aria-labelledby="market-summary-title">
            <header>
              <div>
                <p className="eyebrow">{summaryMode === "ai" ? "AI-generated from retrieved evidence" : "Evidence overview"}</p>
                <h3 id="market-summary-title">What the sampled conversations say</h3>
              </div>
                <span>{summaryMode === "ai" ? "AI summary" : "Local fallback"}</span>
            </header>
            <div className="market-summary-columns">
              <article>
                <h4>United States · English-language baseline</h4>
                <p>{summary.usSummary}</p>
              </article>
              <article>
                <h4>{country.name} · {country.languageName} search lens</h4>
                <p>{summary.localSummary}</p>
              </article>
            </div>
            <article className="market-summary-comparison">
              <h4>Comparison</h4>
              <p>{summary.comparison}</p>
            </article>
            <p className="market-summary-caveat">English-language results are not verified U.S. residents. The selected country is a language/community search lens, not verified poster nationality or a representative national sample. Counts reflect API returns, not attention, prevalence, or investor positioning.</p>
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

async function requestMarketAssist(input: { action: "prepare"; topic: string; country: string; aiConsent: true } | { action: "summarize"; topic: string; country: string; aiConsent: true; evidence: { us: Array<{ source: string; title: string; excerpt: string; language: string }>; local: Array<{ source: string; title: string; excerpt: string; language: string }> } }) {
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

function buildEvidenceSummary(us: ResearchSweepSourceResult["evidence"], local: ResearchSweepSourceResult["evidence"], country: string, sameCountry: boolean): MarketSummary {
  const summarize = (items: ResearchSweepSourceResult["evidence"], label: string) => {
    if (!items.length) return `No matching records were returned from the completed ${label} searches. An empty sample does not establish that the topic is absent.`;
    const sourceCounts = new Map<string, number>();
    for (const item of items) sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
    const sources = [...sourceCounts.entries()].slice(0, 4).map(([source, count]) => `${source} (${count})`).join(", ");
    const excerpts = items.filter(({ transientPreview }) => transientPreview).slice(0, 2).map(({ transientPreview }) => `“${compactOverview(transientPreview!)}”`);
    return `${items.length} matching records were returned from ${sources || "the selected sources"}.${excerpts.length ? ` Sample excerpts: ${excerpts.join("; ")}` : " The returned records do not include usable text excerpts for a content synthesis."}`;
  };
  return {
    usSummary: summarize(us, "English-language baseline"),
    localSummary: sameCountry ? "The United States is selected. This search provides one English-language baseline; it does not represent a separate international view." : summarize(local, `${country} language/community lens`),
    comparison: sameCountry
      ? "No cross-country comparison was run because the selected country is the United States."
      : us.length && local.length
        ? "Both groups returned evidence, but different providers, languages, and server communities are sampled. Treat any contrast as a research lead to inspect—not a measured difference between national populations."
        : "One or both samples are empty or unavailable, so a substantive comparison cannot be made. An empty search is not evidence of absent discussion.",
    limitations: ["This is a free, rule-based evidence overview—not an AI-generated synthesis or representative opinion poll."],
  };
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
        <span className={result.status === "unavailable" ? "source-count source-count--error" : result.status === "not-searched" ? "source-count source-count--muted" : "source-count"}>{result.status === "unavailable" ? "Unavailable" : result.status === "not-searched" ? "Not searched" : result.status === "partial" ? "Partial coverage" : `${result.evidence.length} ${result.evidence.length === 1 ? "result" : "results"}`}</span>
      </header>
      <p className="source-window">{result.window}</p>
      <p className="source-query-meta">Query: <q>{result.query}</q> · Search started {new Date(result.asOf).toISOString().replace("T", " ").replace(".000Z", " UTC")}</p>
      {result.coverageNote && <p className="source-coverage-warning" role="status">{result.coverageNote}</p>}
      {result.error ? (
        <p className="source-empty">This source is temporarily unavailable. Other sources can still return results.</p>
      ) : result.evidence.length ? (
        <>
          <ul>{items.map((item) => (
            <li key={item.id} id={`citation-${citationIds.get(citationKey(result.key, item.id))}`}>
              <span className="source-citation-ref">{citationIds.get(citationKey(result.key, item.id))}</span>
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
              {(item.context?.includes("Preview withheld") || item.context?.includes("Identical normalized text")) && <p className="source-context-note">{item.context}</p>}
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

function compactOverview(value: string) {
  const limit = 210;
  if (value.length <= limit) return value;
  const boundary = value.lastIndexOf(" ", limit);
  return `${value.slice(0, boundary > 140 ? boundary : limit).trimEnd()}…`;
}
