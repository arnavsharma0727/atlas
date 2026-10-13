"use client";

import { useState, type FormEvent } from "react";
import { ATLAS_COUNTRIES, type AtlasClaim, type AtlasComparison, type AtlasSource } from "../lib/atlas-groq";

type Result = { topic: string; country: string; sources: AtlasSource[]; comparison: AtlasComparison | null; notice?: string };

function ClaimList({ claims }: { claims: AtlasClaim[] }) {
  return claims.length ? <ul className="atlas-claims">{claims.map((claim, index) =>
    <li key={`${index}-${claim.text}`}>{claim.text}</li>)}</ul> :
    <p className="atlas-empty">No source-backed point established.</p>;
}

export default function AtlasSearch() {
  const [topic, setTopic] = useState("");
  const [country, setCountry] = useState("KR");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedName = ATLAS_COUNTRIES.find((item) => item.code === (result?.country ?? country))?.name ?? "Selected market";

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = topic.trim();
    if (query.length < 2 || query.length > 100) { setError("Enter a market topic between 2 and 100 characters."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/compare", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: query, country }), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Research is unavailable.");
      setResult(payload as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Research is unavailable."); }
    finally { setLoading(false); }
  }

  return <section className={`atlas-workspace ${result || loading || error ? "atlas-workspace--results" : "atlas-landing"}`}>
    <div className="atlas-search-wrap">
      <h1 className="sr-only">Atlas — the engine for global markets</h1>
      <form className="atlas-search" onSubmit={search}>
        <label className="sr-only" htmlFor="atlas-country">Compare with</label>
        <span className="atlas-globe" aria-hidden="true">◎</span>
        <select id="atlas-country" value={country} onChange={(event) => setCountry(event.target.value)} aria-label="Country to compare with">
          {ATLAS_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        <span className="atlas-search-divider" aria-hidden="true" />
        <label className="sr-only" htmlFor="atlas-query">Market topic</label>
        <input id="atlas-query" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Search a market, company, or idea" autoComplete="off" maxLength={100} />
        <button type="submit" disabled={loading} aria-label={loading ? "Researching" : "Search"}>
          {loading ? <span className="atlas-spinner" aria-hidden="true" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>}
        </button>
      </form>
      <p className="atlas-byline">By: <a href="https://www.linkedin.com/in/arnavsharma0727/" target="_blank" rel="noreferrer">Arnav Sharma UVA30’</a></p>
    </div>

    {loading && <p className="atlas-progress" role="status">Searching current sources and comparing the evidence…</p>}
    {error && <p className="atlas-error" role="alert">{error}</p>}
    {result && <div className="atlas-report">
      <header className="atlas-report-head">
        <div><span className="atlas-kicker">ATLAS / MARKET COMPARISON</span><h2>{result.topic}</h2></div>
        <p>United States <span aria-hidden="true">↔</span> {selectedName}</p>
      </header>
      {result.notice && <p className="atlas-notice" role="status">{result.notice}</p>}
      {result.comparison ? <>
        <div className="atlas-report-grid">
          <section><span className="atlas-section-number">01</span><h3>United States</h3><ClaimList claims={result.comparison.us} /></section>
          {result.country !== "US" && <section><span className="atlas-section-number">02</span><h3>{selectedName}</h3><ClaimList claims={result.comparison.selected} /></section>}
        </div>
        {result.country !== "US" && <section className="atlas-takeaway"><span className="atlas-section-number">03 / COMPARISON</span><h3>Where the evidence differs</h3><ClaimList claims={result.comparison.differences} /></section>}
        {result.comparison.gaps.length > 0 && <p className="atlas-gaps">Not established: {result.comparison.gaps.join(" · ")}</p>}
      </> : result.sources.length ? <>
        <div className="atlas-report-grid">
          <section><span className="atlas-section-number">01 / SOURCE DESCRIPTIONS</span><h3>United States</h3>
            <ClaimList claims={result.sources.filter((source) => source.scope === "US").slice(0, 2).map((source) => ({ text: source.excerpt, sourceIds: [source.id] }))} /></section>
          {result.country !== "US" && <section><span className="atlas-section-number">02 / SOURCE DESCRIPTIONS</span><h3>{selectedName}</h3>
            <ClaimList claims={result.sources.filter((source) => source.scope === "selected").slice(0, 2).map((source) => ({ text: source.excerpt, sourceIds: [source.id] }))} /></section>}
        </div>
        <p className="atlas-gaps">Groq found these pages, but Atlas could not validate a cross-market comparison. These AI-written descriptions are not independently verified; check the original sources below.</p>
      </> : <p className="atlas-empty atlas-no-comparison">Atlas could not find usable source links for this search.</p>}
      <details className="atlas-sources"><summary>Sources & research trail <span>{result.sources.length}</span></summary>
        <p>Groq found these pages through browser search. Atlas checked the link format and citation IDs, not the truth of page content. Open originals before relying on a claim.</p>
        <ol>{result.sources.map((source) => <li key={source.id}>
          <span className="atlas-source-id">{source.id}</span>
          <div><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>
            <small>{source.scope === "US" ? "U.S. search" : source.scope === "selected" ? `${selectedName} search` : "Other context"}{source.publishedAt ? ` · reported ${source.publishedAt}` : " · date unverified"}</small>
            <p>{source.excerpt}</p></div>
        </li>)}</ol>
        {result.comparison && <div className="atlas-claim-map"><h4>Claim references</h4>
          {[...result.comparison.us, ...result.comparison.selected, ...result.comparison.differences].map((claim, index) =>
            <p key={index}>{claim.text} <strong>{claim.sourceIds.join(", ")}</strong></p>)}</div>}
      </details>
      <p className="atlas-scope">AI-assisted source discovery is not a verified national view or investment recommendation. Search coverage, publication dates and source claims can be incomplete or wrong.</p>
    </div>}
  </section>;
}
