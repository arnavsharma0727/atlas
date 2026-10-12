"use client";

import { FormEvent, useEffect, useState } from "react";
import { MARKET_COUNTRIES, marketCountry } from "../../lib/market-countries";
import { topicHashtags } from "../../lib/topic-hashtags";
import { LEMMY_INSTANCES } from "../../lib/lemmy-public";
import { runResearchSweep, type ResearchSweepSourceResult } from "../../lib/research-sweep";
import { buildCitationIds, citationKey } from "../../lib/perspective-snapshot";
import { languageTag } from "../../lib/language-tag";
import { collapseRepeatedEvidenceViews, evidenceBreadthWarning, filterResultsToTopic, flagRepeatedEvidenceViews, selectBalancedEvidence, summarizeEvidenceBreadth, summarizeCitedEvidenceBreadth, type EvidenceBreadth, type MarketSummary } from "../../lib/market-summary";
import { selectOverviewEvidence } from "../../lib/overview-evidence";
import { buildSearchAudit, type AuditRunIdentity } from "../../lib/search-audit";
import { inspectQueryClarity } from "../../lib/query-clarity";
import { hasMaterialEvidenceContext } from "../../lib/evidence-context";
import { marketDiscussionQueries, MARKET_QUERY_PLAN_NOTE } from "../../lib/market-query-plan";
import { selectedCountryContext } from "../../lib/country-context";

export default function ResearchSweep({
  initialTopic,
  onSearchTopic,
  deploymentCommit = null,
}: {
  initialTopic: string;
  onSearchTopic: (topic: string) => void;
  deploymentCommit?: string | null;
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
  const [summaryBreadth, setSummaryBreadth] = useState<{ baseline: EvidenceBreadth; selected: EvidenceBreadth } | null>(null);
  const [screenedOutCounts, setScreenedOutCounts] = useState<{ baseline: number; selected: number } | null>(null);
  const [summaryCandidateCounts, setSummaryCandidateCounts] = useState<Record<string, number>>({});
  const [summaryMode, setSummaryMode] = useState<"ai" | "evidence" | "unavailable">("evidence");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [auditRun, setAuditRun] = useState<AuditRunIdentity | null>(null);
  const [overviewInputIds, setOverviewInputIds] = useState<string[]>([]);
  const [auditPending, setAuditPending] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditMessage, setAuditMessage] = useState("");
  const [summaryProvider, setSummaryProvider] = useState<string | null>(null);
  const revealCitation = () => { const register = document.getElementById("source-register"); if (register instanceof HTMLDetailsElement) register.open = true; };
  const citationIds = buildCitationIds(results);
  const displayResults = collapseRepeatedEvidenceViews(results);
  const searchedCountry = marketCountry(searchedCountryCode);
  const queryClarity = inspectQueryClarity(searchedQuery);
  const countryFacts = selectedCountryContext(results, searchedCountryCode);

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
    setSummaryProvider(null);
    setSummaryBreadth(null);
    setScreenedOutCounts(null);
    setSummaryCandidateCounts({});
    setResults([]);
    setError("");
    setAuditRun(typeof globalThis.crypto?.randomUUID === "function" ? { id: crypto.randomUUID(), privateSalt: crypto.randomUUID() } : null);
    setOverviewInputIds([]);
    setAuditError("");
    setAuditMessage("");
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
        pytorch: true,
        manifoldForecasts: true,
        secEdgar: false,
        worldBankCountryCode: activeCountryCode,
        eiaEnergyPrices: true,
        bisCountryCode: activeCountryCode,
        ecbCountryCode: activeCountryCode,
        bluesky: true,
        blueskyQueries: marketDiscussionQueries(topic, "en"),
        blueskyLanguage: "en",
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
          blueskyQueries: marketDiscussionQueries(localQuery, activeCountry.language),
          blueskyLanguage: activeCountry.language,
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
      const markedResults = flagRepeatedEvidenceViews(filterResultsToTopic(merged, topic, localQuery, activeCountry.language));
      setResults(markedResults);
      const citations = buildCitationIds(markedResults);
      const { evidence: candidateEvidence, candidateCounts, excludedCounts } = selectOverviewEvidence(markedResults, citations, {
        topic, localTopic: localQuery, selectedLanguage: activeCountry.language,
      });
      setSummaryCandidateCounts(candidateCounts);
      setSummaryBreadth({
        baseline: summarizeEvidenceBreadth(candidateEvidence.us),
        selected: summarizeEvidenceBreadth(candidateEvidence.local),
      });
      const evidenceForAi = candidateEvidence;
      setOverviewInputIds([...candidateEvidence.us, ...candidateEvidence.local].map(({ citationId }) => citationId));
      setScreenedOutCounts(excludedCounts);
      const generated = (evidenceForAi.us.length > 0 || evidenceForAi.local.length > 0)
        ? await requestMarketAssist({ action: "summarize", topic, localTopic: localQuery, country: activeCountryCode, evidence: evidenceForAi, aiEnabled: true })
        : { mode: "unavailable", query: "", hashtags: [], summary: null, reason: "no-evidence" };
      if (generated.mode === "ai" && generated.summary) {
        setSummary(activeCountryCode === "US" ? sameCountrySummary(generated.summary) : generated.summary);
        setSummaryMode("ai");
        setSummaryProvider(generated.provider && generated.model ? `${generated.provider} · ${generated.model}` : null);
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

  async function downloadAudit(action: "download" | "copy" = "download") {
    if (!auditRun || !summary || auditPending) return;
    setAuditPending(true);
    setAuditError("");
    setAuditMessage("");
    let objectUrl: string | undefined;
    try {
      const snapshot = buildSearchAudit({
        run: auditRun, deploymentCommit, topic: searchedQuery, localQuery: searchedLocalQuery,
        countryCode: searchedCountryCode, language: searchedCountry.language, queryMethod: localQueryMethod,
        results, candidateCounts: summaryCandidateCounts, overviewInputIds, summary, summaryMode,
      });
      const serialized = snapshot.then((value) => JSON.stringify(value, null, 2));
      if (action === "copy") {
        // Initiate the clipboard operation during the click itself. WebKit
        // requires user activation; the expensive data may resolve afterward.
        if (typeof ClipboardItem === "function" && typeof navigator.clipboard?.write === "function") {
          await navigator.clipboard.write([new ClipboardItem({ "text/plain": serialized.then((value) => new Blob([value], { type: "text/plain" })) })]);
        } else {
          await navigator.clipboard.writeText(await serialized);
        }
        setAuditMessage("Audit JSON copied to your clipboard. Review search phrases before sharing.");
        return;
      }
      objectUrl = URL.createObjectURL(new Blob([await serialized], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `atlas-audit-${auditRun.id}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setAuditError("The local audit could not be exported. Try the other option; your search has not been changed or uploaded.");
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
      setAuditPending(false);
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
        <div className="country-lens-note">
          {searchedCountryCode === "US"
            ? <>English-language baseline · location unverified</>
            : <>{searchedCountry.name} · {searchedCountry.languageName} search · query “{searchedLocalQuery}”{localQueryMethod === "original" ? " · translation unavailable" : ""}</>}
          <details><summary>About this lens</summary><p>{searchedCountryCode === "US"
            ? "Sources do not verify contributor location, so this is not a U.S. sample or a national view."
            : `The selected country is a ${searchedCountry.languageName} language/community search lens, not verified poster location or a representative national sample. The query was ${localQueryMethod === "researcher" ? "entered by you" : localQueryMethod === "translated" ? "automatically translated" : "the original phrase because translation was unavailable"}.`}</p></details>
        </div>
        {searchedCountryCode !== "US" && <details className="local-query-details"><summary>Refine the {searchedCountry.languageName} search phrase</summary><form className="local-query-refinement" onSubmit={(event) => { event.preventDefault(); void search(searchedQuery, localQueryOverride.trim(), searchedCountryCode); }}>
          <label htmlFor="local-query-override">Prefer a specific {searchedCountry.languageName} search phrase?</label>
          <div><input id="local-query-override" value={localQueryOverride} onChange={(event) => setLocalQueryOverride(event.target.value)} maxLength={100} placeholder={`Optional phrase in ${searchedCountry.languageName}`} /><button type="submit" disabled={loading || !localQueryOverride.trim()}>Search this phrase</button></div>
          <small>When provided, this phrase replaces automatic translation for text-query sources; Mastodon converts it to a hashtag. Clear it to return to automatic translation.</small>
        </form></details>}
      </>}
      {searched && loading && <div className="search-loading" role="status"><span className="search-spinner" aria-hidden="true" /> Searching live public sources{searchedCountryCode === "US" ? "" : ` and preparing the ${searchedCountry.name} language/community comparison`} for <strong>“{searchedQuery}”</strong>…</div>}
      {error && <p role="alert" className="search-error">{error}</p>}
      {searched && !loading && !error && summary && (
        <div className="market-results">
          <div className="market-results-heading">
            <div>
              <h2>“{searchedQuery}”</h2>
            </div>
            <p>{searchedCountryCode === "US" ? "English-language baseline" : `${searchedCountry.name} language/community lens · English baseline`}</p>
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
                <p className="eyebrow">{summaryMode === "ai" ? "AI overview" : "Evidence overview"}</p>
                <h3 id="market-summary-title">What the sources say</h3>
              </div>
                <span>{summaryMode === "ai" ? "Checked against cited excerpts" : "AI unavailable"}</span>
            </header>
            <div className={`market-summary-columns${searchedCountryCode === "US" ? " market-summary-columns--single" : ""}`}>
              {searchedCountryCode !== "US" && <article>
                <h4>{searchedCountry.languageName} language/community search</h4>
                <p className="summary-sample-meta">{formatEvidenceBreadth(summaryBreadth?.selected)}</p>
                {summaryBreadth && evidenceBreadthWarning(summaryBreadth.selected) && <p className="summary-sample-caveat" role="status">{evidenceBreadthWarning(summaryBreadth.selected)}</p>}
                <SummaryPassageText passage={summary.localSummary} onOpenCitation={revealCitation} citedBreadth={summaryMode === "ai" ? summarizeCitedEvidenceBreadth(results, citationIds, summary.localSummary.citations) : undefined} />
              </article>}
              <article>
                <h4>English-language baseline · provider language varies</h4>
                <p className="summary-sample-meta">{formatEvidenceBreadth(summaryBreadth?.baseline)}</p>
                {summaryBreadth && evidenceBreadthWarning(summaryBreadth.baseline) && <p className="summary-sample-caveat" role="status">{evidenceBreadthWarning(summaryBreadth.baseline)}</p>}
                <SummaryPassageText passage={summary.usSummary} onOpenCitation={revealCitation} citedBreadth={summaryMode === "ai" ? summarizeCitedEvidenceBreadth(results, citationIds, summary.usSummary.citations) : undefined} />
              </article>
            </div>
            {countryFacts.length > 0 && <section className="country-context" aria-label={`Official data for ${searchedCountry.name}`}>
              <h4>Official data · {searchedCountry.name}</h4>
              <ul>{countryFacts.map(({ sourceKey, item, brief }) => {
                const citationId = citationIds.get(citationKey(sourceKey, item.id));
                return <li key={`${sourceKey}:${item.id}`}>
                  <strong>{item.title}</strong>
                  {brief && <span>{brief}</span>}
                  <small>Observation {item.timeValue} · {item.source}</small>
                  {citationId && <details><summary>Original source</summary><a href={`#citation-${citationId}`} onClick={revealCitation}>Open {citationId} in sources</a></details>}
                </li>;
              })}</ul>
              <p>Publisher observations for this topic, with their own dates and units. They are not community opinions or evidence of current prices.</p>
            </section>}
            {searchedCountryCode !== "US" ? <article className="market-summary-comparison">
              <h4>Comparison</h4>
              <SummaryPassageText passage={summary.comparison} onOpenCitation={revealCitation} />
            </article> : <p className="market-summary-caveat">Choose another language/community lens to compare against this baseline; Atlas cannot verify that baseline contributors are in the United States.</p>}
            <details className="summary-method"><summary>How to read this overview</summary>
            {summaryProvider && <p className="market-summary-caveat">Generated with {summaryProvider}; an additional check used the same provider and model.</p>}
            <p className="market-summary-caveat">Summary scope: at most eight short public discussion excerpts per side. Title-only expert Q&amp;A, reporting, and publisher-analysis headlines listed below are not sent to the summarizer.</p>
            {summaryMode === "ai" && <p className="market-summary-caveat">An additional AI pass checks the draft against the same excerpts for unsupported meaning and omitted contrary views. This is not independent verification: both passes use the same provider/model and can share mistakes. Inspect the supporting quotes and originals.</p>}
            <p className="market-summary-caveat">For social posts with attribution, no more than one excerpt per displayed account from each provider/network enters an overview. Account labels are used only to limit concentration; they are not sent to AI and do not verify a person's identity.</p>
            <p className="market-summary-caveat">Social posts containing an external link, explicitly crediting a publisher, or matching a high-confidence stock-promotion/clickbait phrase screen remain visible in Sources but are excluded from the AI overview. Phrase screens can miss subtle promotion or flag a legitimate post; review each source note.</p>
            <p className="market-summary-caveat">Each source's “pass overview filters” count is the number of unique excerpts that passed the available-language, citation, topic, market-vocabulary, and independence checks before per-platform/account balancing and the eight-excerpt cap; it does not mean every candidate was sent to AI. The source register omits results whose titles or excerpts do not contain a query-topic term, while preserving provider-return and screened-out counts. Synonym-only posts can be missed, and passing a screen does not prove relevance. In addition, {screenedOutCounts?.baseline ?? 0} baseline and {screenedOutCounts?.selected ?? 0} selected-lens excerpts failed the topic, market-vocabulary, or independence checks.</p>
            <p className="market-summary-caveat">The selected-language AI overview uses matching provider language labels, or conservative script detection for Korean, Japanese, and Hindi when labels are missing. Explicitly mismatched labels and other unknown languages are excluded; language does not establish a poster’s location or nationality.</p>
            <p className="market-summary-caveat">The baseline is not a U.S. sample and may include mixed languages. Bluesky receives the official English-language filter for the baseline and selected-language filter for the local lens, independently of phrase length; provider labels can be wrong. Lemmy uses the phrase shown for each provider, and Mastodon searches the displayed hashtag. The selected lens is not verified poster nationality or a representative national sample. Counts are API returns, not attention, prevalence, or investor positioning.</p>
            <p className="market-summary-caveat">{MARKET_QUERY_PLAN_NOTE}</p>
            {!!summary.limitations.length && <ul className="market-summary-limitations">{summary.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
            </details>
          </section>

          <details className="source-register" id="source-register">
            <summary>View sources and citations <span>{displayResults.reduce((count, view) => count + view.evidence.length, 0)} linked records · source coverage</span></summary>
          <section className="source-citations" aria-labelledby="source-citations-title">
            <header>
              <div>
                <p className="eyebrow">Evidence</p>
                <h3 id="source-citations-title">Sources &amp; citations</h3>
              </div>
              <p>Original links and provider-specific coverage, collected below the summary.</p>
            </header>
            <details className="search-audit">
              <summary>Search audit</summary>
              <p>Download queries, source states, counts, and pseudonymous record references. No forum text, author details, source links, or summary wording is included. Your search phrases are included; review before sharing. This is an observation log, not a research-quality assessment.</p>
              <button className="show-more-results" type="button" onClick={() => void downloadAudit()} disabled={!auditRun || auditPending}>{auditPending ? "Preparing audit…" : "Download audit JSON"}</button>
              <button className="show-more-results" type="button" onClick={() => void downloadAudit("copy")} disabled={!auditRun || auditPending}>Copy audit JSON</button>
              {auditMessage && <p role="status">{auditMessage}</p>}
              {auditError && <p role="alert">{auditError}</p>}
            </details>
            <div className="market-results-grid">
              {displayResults.map((view, index) => <SourceResults key={`${view.result.key}:${index}`} result={view.result} evidence={view.evidence} returnedCount={view.returnedCount} duplicateCount={view.duplicateCount} summaryCandidateCount={summaryCandidateCounts[view.result.key] ?? 0} citationIds={citationIds} summaryCitationIds={new Set([...summary.usSummary.citations, ...summary.localSummary.citations, ...summary.comparison.citations])} />)}
            </div>
          </section>
          </details>
          <details className="search-limits"><summary>Coverage and privacy</summary><p>Public API results are incomplete samples. They can omit content, overlap across federated servers, and reflect platform/language selection. An AI summary describes only the retrieved sample; inspect original sources before drawing conclusions. <a href="/sources">How sources work</a> · <a href="/privacy">Privacy</a>.</p></details>
        </div>
      )}
    </section>
  );
}

async function requestMarketAssist(input: { action: "prepare"; topic: string; country: string; aiEnabled: true } | { action: "summarize"; topic: string; localTopic: string; country: string; aiEnabled: true; evidence: { us: ReturnType<typeof selectBalancedEvidence>; local: ReturnType<typeof selectBalancedEvidence> } }) {
  try {
    const response = await fetch("/api/research/market-assist", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const body = await response.json() as { mode?: string; query?: string; hashtags?: string[]; summary?: MarketSummary; reason?: string; provider?: string; model?: string };
    if (!response.ok) return { mode: "unavailable", query: body.query ?? "", hashtags: body.hashtags ?? [], summary: null, reason: body.reason ?? (response.status === 429 ? "request-limited" : "provider-error") };
    return { mode: body.mode, query: body.query ?? "", hashtags: body.hashtags ?? [], summary: body.summary ?? null, provider: body.provider, model: body.model, ...(body.reason ? { reason: body.reason } : {}) };
  } catch {
    return { mode: "unavailable", query: input.action === "prepare" ? input.topic : "", hashtags: input.action === "prepare" ? topicHashtags(input.topic) : [], summary: null, reason: "network-error" };
  }
}

function buildEvidenceSummary(us: ReturnType<typeof selectBalancedEvidence>, local: ReturnType<typeof selectBalancedEvidence>, country: string, sameCountry: boolean, failureReason?: string): MarketSummary {
  const summarize = (items: ReturnType<typeof selectBalancedEvidence>, label: string) => items.length
    ? { text: `Selected excerpts from the ${label}:`, citations: items.slice(0, 2).map(({ citationId }) => citationId),
      claims: items.slice(0, 2).map(({ citationId, source, excerpt }) => {
        const quote = excerpt.trim().slice(0, 160);
        return { text: `${source} excerpt: “${quote}${excerpt.trim().length > quote.length ? "…" : ""}”`, citations: [citationId], supportingQuotes: [{ citationId, quote }] };
      }) }
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
    case "no-evidence": return "No text excerpts qualified for an AI overview in this search; the source register still shows the original results.";
    case "disabled": return "AI summaries are not enabled or configured by the operator; this local overview remains available.";
    case "rate-limited": return "The free AI provider reported a usage limit; this local overview is shown instead.";
    case "request-limited": return "Atlas's AI request limit was reached; this local overview is shown instead.";
    case "timeout": return "The AI provider did not respond in time; this local overview is shown instead.";
    case "citation-validation": return "The AI response did not pass Atlas's citation, evidence, or numeric-claim checks; this non-claiming local overview is shown instead.";
    case "grounding-validation": return "An additional AI check rejected or could not confidently support the draft's meaning or treatment of contrary evidence. The draft was withheld; this non-claiming local overview is shown instead.";
    case "grounding-unavailable": return "The additional AI grounding check could not finish within the available request or time budget. The unchecked draft was withheld; this non-claiming local overview is shown instead.";
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

export function SummaryPassageText({ passage, citedBreadth, onOpenCitation }: { passage: MarketSummary["usSummary"]; citedBreadth?: EvidenceBreadth; onOpenCitation?: () => void }) {
  // Keep the overview readable while letting a researcher jump directly to
  // each source record supporting this passage in the consolidated register.
  return <div className="summary-passage">
    {passage.claims?.length ? <div className="space-y-4">{passage.claims.map((claim, index) => <SummaryPassageText key={index} passage={claim} onOpenCitation={onOpenCitation} />)}</div> : <p>{passage.text}</p>}
    {!passage.claims?.length && passage.citations.length > 0 && <details className="summary-citation-disclosure">
      <summary>Sources for this point · {passage.citations.length}</summary>
      <span className="summary-citations" aria-label="Evidence sources">
        {passage.citations.map((citationId, index) => (
          <span key={citationId}>{index > 0 ? ", " : ""}<a href={`#citation-${citationId}`} onClick={onOpenCitation} aria-label={`Open source ${citationId}`}>{citationId}</a></span>
        ))}
      </span>
      {!!passage.supportingQuotes?.length && <ul className="summary-quote-list">{passage.supportingQuotes.map(({ citationId, quote }, index) => (
        <li key={`${citationId}:${index}`}><a href={`#citation-${citationId}`} onClick={onOpenCitation}>{citationId}</a> “{quote}”</li>
      ))}</ul>}
    </details>}
    {citedBreadth && passage.citations.length > 0 && <details className="summary-citation-disclosure"><summary>Evidence scope</summary>
      <p className="summary-sample-meta">Cited basis: {citedBreadth.excerptCount} unique {citedBreadth.excerptCount === 1 ? "record" : "records"} · {citedBreadth.platformLabels.length} {citedBreadth.platformLabels.length === 1 ? "platform" : "platforms"}{citedBreadth.platformLabels.length > 0 ? `: ${citedBreadth.platformLabels.join(", ")}` : ""}. Citation coverage does not establish agreement or independence.</p>
      <p className="summary-sample-caveat">Event timing is unverified: recent posts may describe different historical periods, forecasts, or current conditions.</p>
      {citedBreadth.platformLabels.length === 1 && <p className="summary-sample-caveat">This AI overview cites one platform only, even if other platforms appear in the selected inputs.</p>}
    </details>}
  </div>;
}

export function SourceResults({ result, evidence, returnedCount, duplicateCount, summaryCandidateCount, citationIds, summaryCitationIds }: { result: ResearchSweepSourceResult; evidence: ResearchSweepSourceResult["evidence"]; returnedCount: number; duplicateCount: number; summaryCandidateCount: number; citationIds: Map<string, string>; summaryCitationIds: Set<string> }) {
  const [showAll, setShowAll] = useState(false);
  const items = visibleSummaryEvidence(evidence, showAll, result.key, citationIds, summaryCitationIds);
  const countsLabel = `${evidence.length} topic matches · ${returnedCount} returned${result.adapterExcludedCount ? ` · ${result.adapterExcludedCount} source-safety exclusions` : ""}${result.topicExcludedCount ? ` · ${result.topicExcludedCount} screened out` : ""}${duplicateCount ? ` · ${duplicateCount} duplicates` : ""}`;
  const statusLabel = result.status === "unavailable" ? "Unavailable" : result.status === "not-searched" ? "Not searched" : result.status === "partial" ? `Partial coverage · ${countsLabel}` : countsLabel;
  return (
    <section className="source-results" aria-label={result.label}>
      <header>
        <h3>{result.label}</h3>
        <span className={result.status === "unavailable" ? "source-count source-count--error" : result.status === "not-searched" ? "source-count source-count--muted" : "source-count"}>{statusLabel}</span>
      </header>
      <p className="source-window">{result.window}</p>
      <p className="source-query-meta">Query: <q>{result.query}</q> · Started {new Date(result.asOf).toLocaleString()} local time · Retrieved {new Date(result.retrievedAt ?? result.asOf).toLocaleString()} local time</p>
      <p className="source-overview-count">{["world-bank-macro", "eia-energy-prices", "bis-effective-exchange"].includes(result.key) ? "Official statistical context · excluded from community overviews" : `${summaryCandidateCount} unique excerpt${summaryCandidateCount === 1 ? "" : "s"} pass overview filters before platform/account balancing and the eight-item cap.`}</p>
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
              {(item.evidenceClass === "crowd forecast" || item.evidenceClass === "official statistical data" || hasMaterialEvidenceContext(item.context)) && <p className={item.evidenceClass === "crowd forecast" ? "source-context-note source-context-note--forecast" : "source-context-note"}>{item.context}</p>}
              {item.transientPreview && item.transientPreview !== item.title && <p className="source-preview" lang={languageTag(item.language)}>{compactPreview(item.transientPreview)}</p>}
              <p className="source-meta">{item.evidenceClass} · {item.source} · {item.language} · {item.timeLabel.toLowerCase()} <time dateTime={item.timeValue}>{/^\d{4}(?:-\d{2}){0,2}$/u.test(item.timeValue) ? item.timeValue : new Date(item.timeValue).toISOString().replace("T", " ").replace(".000Z", " UTC")}</time></p>
              {item.attribution && <p className="source-meta">Attribution: {item.attributionUrl
                ? <a href={item.attributionUrl} target="_blank" rel="noreferrer">{item.attribution}</a>
                : item.attribution}{item.licenseName && <> · License: {item.licenseUrl
                  ? <a href={item.licenseUrl} target="_blank" rel="noreferrer">{item.licenseName}</a>
                  : item.licenseName}</>}</p>}
            </li>
          ))}</ul>
          {evidence.length > items.length && <button className="show-more-results" type="button" onClick={() => setShowAll(true)}>Show all {evidence.length} unique results</button>}
        </>
      ) : result.topicExcludedCount ? (
        <p className="source-empty">No displayed records matched the searched topic terms. {result.topicExcludedCount} were screened from this register; related items using different wording may have been missed.</p>
      ) : result.adapterExcludedCount && result.adapterExcludedCount === returnedCount ? (
        <p className="source-empty">All {returnedCount} API records failed freshness, moderation, bot, or record-safety checks before topic filtering. This is a filtered response, not evidence that discussion is absent.</p>
      ) : returnedCount > 0 && duplicateCount > 0 ? (
        <p className="source-empty">{duplicateCount} {duplicateCount === 1 ? "record also appeared" : "records also appeared"} in another selected view. Repeated appearances are one original record, not independent corroboration.</p>
      ) : returnedCount > 0 ? (
        <p className="source-empty">The source returned records, but none are displayable in this view. Review the source status and exclusion notes; this does not establish absence of discussion.</p>
      ) : (
        <div className="source-empty"><span className="source-empty-mark" aria-hidden="true">↗</span><div><strong>Search completed · no matching records returned</strong><p>Try another phrase or query lens. An empty result does not mean the topic is absent from this source.</p></div></div>
      )}
    </section>
  );
}

export function visibleSummaryEvidence(
  evidence: ResearchSweepSourceResult["evidence"],
  showAll: boolean,
  resultKey: string,
  citationIds: Map<string, string>,
  summaryCitationIds: Set<string>,
) {
  if (showAll) return evidence;
  const citedItems = evidence.filter((item) => summaryCitationIds.has(citationIds.get(citationKey(resultKey, item.id)) ?? ""));
  return [...new Map([...evidence.slice(0, 8), ...citedItems].map((item) => [item.id, item])).values()];
}

function formatEvidenceBreadth(breadth: EvidenceBreadth | undefined) {
  if (!breadth) return "Evidence sample: coverage unavailable.";
  if (!breadth.excerptCount) return "Evidence sample: no excerpts passed the overview filters.";
  const platformCount = breadth.platformLabels.length;
  const platforms = platformCount ? ` · ${platformCount} ${platformCount === 1 ? "platform" : "platforms"}: ${breadth.platformLabels.join(", ")}` : " · source platform not identified";
  return `Selected overview inputs: ${breadth.excerptCount} ${breadth.excerptCount === 1 ? "excerpt" : "excerpts"}${platforms}.`;
}

function compactPreview(value: string) {
  const limit = 420;
  if (value.length <= limit) return value;
  const boundary = value.lastIndexOf(" ", limit);
  return `${value.slice(0, boundary > 280 ? boundary : limit).trimEnd()}…`;
}
