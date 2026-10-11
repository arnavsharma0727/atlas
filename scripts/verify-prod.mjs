#!/usr/bin/env node

const base = (process.env.VERIFY_PROD_URL || "https://signal-scout-xi-ruby.vercel.app").replace(/\/$/, "");
const checks = [];
const pass = (name, detail) => checks.push({ name, ok: true, detail });
const fail = (name, detail) => checks.push({ name, ok: false, detail });

for (const route of ["/", "/explore", "/sources", "/privacy", "/methodology", "/contact"]) {
  try {
    const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(15000) });
    if (response.ok) pass(`public route ${route}`, `HTTP ${response.status}`);
    else fail(`public route ${route}`, `HTTP ${response.status}`);
  } catch (error) {
    fail(`public route ${route}`, error instanceof Error ? error.message : "request failed");
  }
}

try {
  const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  if (response.ok && !page.includes("The Engine for Global Markets") && page.includes("Search a market, company, or idea") && page.includes("By: <a") && page.includes("Arnav Sharma UVA30") && page.includes("https://www.linkedin.com/in/arnavsharma0727/") && !page.includes("Search automatically creates an AI summary") && page.includes("market-globe-icon") && page.includes("market-search-icon")) {
    pass("focused Atlas search landing", "project subtitle and long notice are absent; globe, country selector, search icon, and LinkedIn byline are rendered");
  } else {
    fail("focused Atlas search landing", `HTTP ${response.status}; expected Atlas brand and search field were not found`);
  }
} catch (error) {
  fail("focused Atlas search landing", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  if (response.ok && page.includes("marked as automated") && page.includes("omitted from the AI discussion sample")) {
    pass("Mastodon automated-account boundary", "self-declared automated-account posts stay citable but are excluded from AI discussion text");
  } else {
    fail("Mastodon automated-account boundary", "the source register does not disclose bot-text handling");
  }
} catch (error) {
  fail("Mastodon automated-account boundary", error instanceof Error ? error.message : "request failed");
}

try {
  const [sourcesResponse, privacyResponse] = await Promise.all([
    fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) }),
  ]);
  const [sourcesPage, privacyPage] = await Promise.all([sourcesResponse.text(), privacyResponse.text()]);
  if (
    sourcesResponse.ok && privacyResponse.ok &&
    sourcesPage.includes("Manifold · play-money community forecasts") &&
    sourcesPage.includes("MANA is platform play money") &&
    sourcesPage.includes("never sent to the AI summarizer") &&
    privacyPage.includes("Manifold search terms are also sent directly") &&
    privacyPage.includes("not sent to Groq")
  ) {
    pass("Manifold source and privacy boundaries", "play-money-only source policy and direct-query disclosure are present; forecast data stays outside Groq summaries");
  } else {
    fail("Manifold source and privacy boundaries", "source policy or direct-query privacy disclosure is missing");
  }
} catch (error) {
  fail("Manifold source and privacy boundaries", error instanceof Error ? error.message : "request failed");
}

try {
  const sourcesResponse = await fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) });
  const sourcesPage = await sourcesResponse.text();
  const privacyResponse = await fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) });
  const privacyPage = await privacyResponse.text();
  if (sourcesResponse.ok && privacyResponse.ok &&
    sourcesPage.includes("OpenAlex · recent global research metadata") &&
    sourcesPage.includes("keyless casual-use budget") &&
    sourcesPage.includes("Metadata is CC0") &&
    privacyPage.includes("OpenAlex and Crossref searches")) {
    pass("OpenAlex free-source disclosure", "keyless quota, CC0 metadata, title-only scope, and server-side search privacy are disclosed");
  } else {
    fail("OpenAlex free-source disclosure", "source register or privacy disclosures are missing");
  }
} catch (error) {
  fail("OpenAlex free-source disclosure", error instanceof Error ? error.message : "request failed");
}

for (const route of ["/about", "/briefs", "/candidates", "/companies", "/companies/NVDA", "/coverage", "/divergences/example", "/login", "/watchlists"]) {
  try {
    const response = await fetch(`${base}${route}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location && new URL(location, base).pathname === "/") {
      pass(`retired route ${route}`, `redirects to the focused search landing (HTTP ${response.status})`);
    } else {
      fail(`retired route ${route}`, `expected redirect to /, got HTTP ${response.status}`);
    }
  } catch (error) {
    fail(`retired route ${route}`, error instanceof Error ? error.message : "request failed");
  }
}

for (const [name, route, method] of [
  ["scheduled ingestion", "/api/ingest", "GET"],
  ["metrics recompute", "/api/metrics/recompute", "POST"],
]) {
  try {
    const response = await fetch(`${base}${route}`, { method, signal: AbortSignal.timeout(10000) });
    if (response.status === 401 || response.status === 403) pass(`${name} endpoint protected`, `unauthenticated request returned HTTP ${response.status}`);
    else fail(`${name} endpoint protected`, `expected 401/403, got HTTP ${response.status}`);
  } catch (error) {
    fail(`${name} endpoint protected`, error instanceof Error ? error.message : "request failed");
  }
}

for (const [name, route, resultKey] of [
  ["OpenAlex research metadata", "/api/research/openalex", "works"],
  ["Crossref research metadata", "/api/research/crossref", "works"],
  ["arXiv research metadata", "/api/research/arxiv", "records"],
]) {
  try {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "electric vehicles" }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await response.json().catch(() => null);
    const results = body && Array.isArray(body[resultKey]) ? body[resultKey] : null;
    if (response.ok && results && results.every((item) => typeof item.title === "string" && typeof item.url === "string")) {
      pass(`${name} route`, `HTTP ${response.status}; ${results.length} valid metadata records`);
    } else {
      fail(`${name} route`, `HTTP ${response.status}; expected a ${resultKey} array of title/URL records`);
    }
  } catch (error) {
    fail(`${name} route`, error instanceof Error ? error.message : "request failed");
  }
}

try {
  const response = await fetch(`${base}/api/operator/takedown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401 || response.status === 503) {
    pass("source takedown endpoint fails closed", `unauthenticated or unconfigured request returned HTTP ${response.status}`);
  } else {
    fail("source takedown endpoint fails closed", `expected 401/503, got HTTP ${response.status}`);
  }
} catch (error) {
  fail("source takedown endpoint fails closed", error instanceof Error ? error.message : "request failed");
}

console.log(`Atlas product verification: ${base}`);
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
const failed = checks.filter(({ ok }) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed; ${failed} checks failed.`);
if (failed) process.exitCode = 1;
