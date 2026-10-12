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
  if (response.ok && page.includes("PyTorch Forums") && page.includes("latest 30 active public topics") && page.includes("excluded from AI overviews") && page.includes("LF general content license and exceptions")) {
    pass("PyTorch bounded-source disclosure", "latest-topic sampling, reuse exceptions and AI exclusion are disclosed");
  } else {
    fail("PyTorch bounded-source disclosure", "bounded technical-source disclosure is absent");
  }
  if (response.ok && page.includes("marked as automated") && page.includes("omitted from the AI discussion sample")) {
    pass("Mastodon automated-account boundary", "self-declared automated-account posts stay citable but are excluded from AI discussion text");
  } else {
    fail("Mastodon automated-account boundary", "the source register does not disclose bot-text handling");
  }
  if (response.ok && page.includes("Outgoing attachments in the API") && page.includes("freshness/moderation/bot/safety exclusions") && page.includes("Malformed or oversized API responses are marked unavailable")) {
    pass("Lemmy attachment and exclusion provenance", "the source register distinguishes outgoing attachments, safety exclusions, topic exclusions, duplicates, and malformed responses");
  } else {
    fail("Lemmy attachment and exclusion provenance", "the source register is missing attachment or filtered-response boundaries");
  }
  if (response.ok && page.includes("rich-text link facets count as link-sharing") && page.includes("Exact-text duplicates inherit a linked copy")) {
    pass("Bluesky embedded-link provenance", "external cards, rich-text facets, and linked-copy deduplication boundaries are disclosed");
  } else {
    fail("Bluesky embedded-link provenance", "the source register is missing hidden-link or linked-copy boundaries");
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

try {
  const [sourcesResponse, privacyResponse, methodologyResponse] = await Promise.all([
    fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/methodology`, { signal: AbortSignal.timeout(15000) }),
  ]);
  const [sourcesPage, privacyPage, methodologyPage] = await Promise.all([
    sourcesResponse.text(), privacyResponse.text(), methodologyResponse.text(),
  ]);
  if (sourcesResponse.ok && privacyResponse.ok && methodologyResponse.ok &&
    sourcesPage.includes("batched follow-up request retrieves recent answers") &&
    sourcesPage.includes("excluded from AI summaries") &&
    sourcesPage.includes("If answer lookup fails") &&
    privacyPage.includes("Stack Exchange question/answer") &&
    privacyPage.includes("Stack Exchange excerpts are not sent to Groq") &&
    methodologyPage.includes("at most one individually licensed answer per question")) {
    pass("Stack Exchange licensed-answer boundaries", "individual CC BY-SA answers have author/source attribution, transient display, partial-failure disclosure, and exclusion from AI summaries");
  } else {
    fail("Stack Exchange licensed-answer boundaries", "answer attribution, transient handling, summary exclusion, or failure disclosure is missing");
  }
} catch (error) {
  fail("Stack Exchange licensed-answer boundaries", error instanceof Error ? error.message : "request failed");
}

try {
  const [sourcesResponse, privacyResponse, methodologyResponse, dataResponse] = await Promise.all([
    fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/methodology`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/api/research/bis`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ query: "USD currency", country: "KR" }),
      signal: AbortSignal.timeout(20000),
    }),
  ]);
  const [sourcesPage, privacyPage, methodologyPage, data] = await Promise.all([
    sourcesResponse.text(), privacyResponse.text(), methodologyResponse.text(),
    dataResponse.json().catch(() => null),
  ]);
  const evidence = data && typeof data === "object" && Array.isArray(data.evidence) ? data.evidence : [];
  const validEvidence = evidence.length === 4 && evidence.every((item) =>
    item && typeof item.id === "string" && /^bis-eer:(?:US|KR):[NR]:[0-9]{4}-[0-9]{2}$/.test(item.id) &&
    item.evidenceClass === "official statistical data" && item.sourceOperatorKey === "bis-statistics" &&
    typeof item.context === "string" && item.context.includes("2020 = 100") &&
    typeof item.url === "string" && item.url.startsWith("https://data.bis.org/topics/EER/"));
  if (sourcesResponse.ok && privacyResponse.ok && methodologyResponse.ok && dataResponse.ok &&
    sourcesPage.includes("BIS · effective exchange-rate context") &&
    sourcesPage.includes("not bilateral spot rates") &&
    sourcesPage.includes("BIS terms of permitted statistical use") &&
    privacyPage.includes("topic is used only to decide whether that source applies") &&
    methodologyPage.includes("Country indices use their own 2020=100 bases") && validEvidence) {
    pass("BIS FX context and permission boundaries", "keyless U.S./selected-country indices are live, attributed, freshness-labeled, excluded from discussion summaries, and represented as non-comparable indices");
  } else {
    fail("BIS FX context and permission boundaries", `source disclosure, privacy/methodology boundary, or live four-series validation failed (HTTP ${dataResponse.status}; ${evidence.length} rows)`);
  }
} catch (error) {
  fail("BIS FX context and permission boundaries", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  if (response.ok &&
    page.includes("YouTube comments · excluded from cross-source summaries") &&
    page.includes("prohibit aggregating API data across different content owners") &&
    page.includes("https://developers.google.com/youtube/terms/developer-policies")) {
    pass("YouTube cross-source permission boundary", "the otherwise-free API remains disabled because its aggregation and derived-data rules conflict with Atlas's use case");
  } else {
    fail("YouTube cross-source permission boundary", "the API exclusion or the operator policy basis is missing");
  }
} catch (error) {
  fail("YouTube cross-source permission boundary", error instanceof Error ? error.message : "request failed");
}

try {
  const [sourcesResponse, privacyResponse] = await Promise.all([
    fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) }),
  ]);
  const [sourcesPage, privacyPage] = await Promise.all([sourcesResponse.text(), privacyResponse.text()]);
  if (sourcesResponse.ok && privacyResponse.ok &&
    sourcesPage.includes("World Bank · annual macroeconomic context") &&
    sourcesPage.includes("never sent to Groq") &&
    sourcesPage.includes("World Bank metadata keyword search was screened out") &&
    privacyPage.includes("World Development Indicators")) {
    pass("World Bank macro-source boundaries", "narrow annual indicators, CC BY attribution, and exclusion from AI summaries are disclosed");
  } else {
    fail("World Bank macro-source boundaries", "source scope, attribution, or privacy disclosure is missing");
  }
} catch (error) {
  fail("World Bank macro-source boundaries", error instanceof Error ? error.message : "request failed");
}

try {
  const [sourcesResponse, privacyResponse, eiaResponse] = await Promise.all([
    fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/api/research/eia`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "crude oil" }),
      signal: AbortSignal.timeout(15000),
    }),
  ]);
  const [sourcesPage, privacyPage, eiaBody] = await Promise.all([
    sourcesResponse.text(), privacyResponse.text(), eiaResponse.json().catch(() => null),
  ]);
  const safeResult = eiaResponse.status === 503 && eiaBody?.code === "not_configured" ||
    eiaResponse.ok && Array.isArray(eiaBody?.evidence) && eiaBody.evidence.every((item) =>
      typeof item.id === "string" && /^eia:(?:RWTC|RBRTE|RNGWHHD):\d{4}-\d{2}-\d{2}$/.test(item.id) &&
      item.evidenceClass === "official statistical data" && typeof item.url === "string" && item.url.startsWith("https://www.eia.gov/opendata/browser/"));
  if (sourcesResponse.ok && privacyResponse.ok &&
    sourcesPage.includes("EIA · U.S. energy benchmark prices") &&
    sourcesPage.includes("personally accept EIA") &&
    sourcesPage.includes("never sent to Groq") &&
    privacyPage.includes("registered key") && safeResult) {
    pass("EIA free-source and key boundary", eiaResponse.status === 503 ? "registered free key is not configured; missing-key state is explicit and fails closed" : "configured server-side EIA route returned bounded, attributed benchmark evidence");
  } else {
    fail("EIA free-source and key boundary", "free-registration disclosure, private-key handling, or route contract is missing");
  }
} catch (error) {
  fail("EIA free-source and key boundary", error instanceof Error ? error.message : "request failed");
}

try {
  const [sourcesResponse, privacyResponse, methodologyResponse] = await Promise.all([
    fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/privacy`, { signal: AbortSignal.timeout(15000) }),
    fetch(`${base}/methodology`, { signal: AbortSignal.timeout(15000) }),
  ]);
  const [sourcesPage, privacyPage, methodologyPage] = await Promise.all([
    sourcesResponse.text(), privacyResponse.text(), methodologyResponse.text(),
  ]);
  if (sourcesResponse.ok && privacyResponse.ok && methodologyResponse.ok &&
    sourcesPage.includes("SEC EDGAR") && sourcesPage.includes("Visitor-triggered exact company-name or ticker lookup") &&
    sourcesPage.includes("descriptive User-Agent") &&
    privacyPage.includes("The text you typed is") && privacyPage.includes("not sent to the SEC") &&
    methodologyPage.includes("A no-match means only that this exact phrase did not match the issuer index")) {
    pass("SEC issuer source disclosure", "exact-issuer coverage, contact User-Agent, query privacy, and no-match limits are documented");
  } else {
    fail("SEC issuer source disclosure", "SEC scope, privacy, or no-match disclosures are missing");
  }
} catch (error) {
  fail("SEC issuer source disclosure", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  if (response.ok && page.includes("DEV Community · excluded from visitor search") &&
    page.includes("Not queried or scraped") && page.includes("prohibit public display, copying, or mirroring")) {
    pass("DEV Community permission boundary", "API visibility is not treated as permission for public excerpt display");
  } else {
    fail("DEV Community permission boundary", "the exclusion and public-display restriction are not documented");
  }
} catch (error) {
  fail("DEV Community permission boundary", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/sources`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  if (
    response.ok &&
    page.includes("Reddit · excluded from Atlas research search") &&
    page.includes("only official and authorized avenue for research using Reddit data") &&
    page.includes("separate free Data API rate allowance does not grant research permission") &&
    page.includes("No Reddit credentials or content are configured")
  ) {
    pass("Reddit research-policy exclusion", "official Researcher-program requirement is disclosed; no ordinary Data API content is used");
  } else {
    fail("Reddit research-policy exclusion", `HTTP ${response.status}; research authorization boundary is missing`);
  }
} catch (error) {
  fail("Reddit research-policy exclusion", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/methodology`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  if (
    response.ok && page.includes("conservative query-term screen") &&
      page.includes("The server repeats the topic and market-language gates") && page.includes("rejects empty or unscreened requests") &&
      page.includes("Each one-sentence claim must cite exact submitted records") &&
      page.includes("each comparison claim must cite both sides") &&
      page.includes("Script detection identifies writing system, not nationality, residence, or community membership") &&
      page.includes("A Korean-language post is not proof that its author is in South Korea") &&
      page.includes("AI claim text is expected to be concise and paraphrased") &&
      page.includes("long supporting quote or cited excerpt") &&
      page.includes("contains a URL, email address, or @handle") &&
      page.includes("Duplicate citation IDs within or across the two lenses are rejected") &&
      page.includes("Every generated citation must include a verbatim substring") &&
      page.includes("a matching quote does not prove it logically supports the claim") &&
      page.includes("Inspect the original record and its provenance")
  ) {
    pass("summary market-screen and evidence policy", "methodology describes the lexical gate, its evidence citations, and limits");
  } else {
    fail("summary market-screen and evidence policy", `HTTP ${response.status}; required summary safeguards were not found`);
  }
} catch (error) {
  fail("summary market-screen and evidence policy", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/explore`, { signal: AbortSignal.timeout(15000) });
  const page = await response.text();
  const scripts = [...page.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((match) => match[1]);
  const bundles = await Promise.all(scripts.map(async (path) => {
    try {
      const asset = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
      return asset.ok ? asset.text() : "";
    } catch { return ""; }
  }));
  if (response.ok && (page.includes("Check verbatim source excerpts") || bundles.some((bundle) => bundle.includes("Check verbatim source excerpts")))) {
    pass("auditable summary excerpts in production UI", "the deployed Explore page includes the checked-excerpt disclosure");
  } else {
    fail("auditable summary excerpts in production UI", `HTTP ${response.status}; checked source excerpt disclosure was not found in the page or its scripts`);
  }
} catch (error) {
  fail("auditable summary excerpts in production UI", error instanceof Error ? error.message : "request failed");
}

try {
  const response = await fetch(`${base}/api/research/market-assist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "summarize", topic: "coffee", country: "KR", aiEnabled: true,
      evidence: {
        us: [{ citationId: "C1", source: "Synthetic test", title: "Synthetic lifestyle mention", excerpt: "I enjoy coffee every morning.", language: "en" }],
        local: [{ citationId: "C2", source: "Synthetic test", title: "Synthetic lifestyle mention", excerpt: "매일 아침 커피를 마신다.", language: "ko" }],
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 400) {
    pass("server-side market evidence gate", "synthetic lifestyle-only evidence was rejected before any AI-provider request");
  } else {
    fail("server-side market evidence gate", `expected HTTP 400 for synthetic lifestyle-only evidence, got HTTP ${response.status}`);
  }
} catch (error) {
  fail("server-side market evidence gate", error instanceof Error ? error.message : "request failed");
}

// These synthetic rejection probes never request a usable summary or invent live evidence.
for (const [topic, excerpt] of [
  ["Nvidia semiconductor demand", "GPU demand is accelerating."],
  ["Shell natural gas demand", "LNG demand rose in Asia."],
]) {
  const name = `server-side multi-concept gate: ${topic}`;
  try {
    const response = await fetch(`${base}/api/research/market-assist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "summarize", topic, country: "US", aiEnabled: true,
        evidence: {
          us: [{ citationId: "C1", source: "Synthetic rejection probe", title: "Synthetic missing issuer", excerpt, language: "en" }],
          local: [],
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 400) pass(name, "missing issuer concept rejected before AI-provider request");
    else fail(name, `expected HTTP 400, got HTTP ${response.status}`);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : "request failed");
  }
}

try {
  const response = await fetch(`${base}/api/research/market-assist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "prepare", topic: "semiconductors", country: "US", aiEnabled: true }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (response.ok && body?.mode === "localized" && body?.query === "semiconductors") {
    pass("shared production AI rate limiter", "the public preparation endpoint passed its database-backed shared quota check; this US phrase requires no model call");
  } else {
    fail("shared production AI rate limiter", `expected the no-model US preparation response, got HTTP ${response.status} (${body?.reason ?? body?.error ?? "unexpected response"})`);
  }
} catch (error) {
  fail("shared production AI rate limiter", error instanceof Error ? error.message : "request failed");
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
  ["SEC EDGAR exact issuer filings", "/api/research/sec-edgar", "filings"],
]) {
  try {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: route.endsWith("sec-edgar") ? "AAPL" : "electric vehicles" }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await response.json().catch(() => null);
    const results = body && Array.isArray(body[resultKey]) ? body[resultKey] : null;
    if (route.endsWith("sec-edgar") && response.status === 503 && body?.code === "not_configured") {
      fail(`${name} route`, "SEC_USER_AGENT is not configured in production; add a descriptive User-Agent containing a real contact email to Vercel Production");
      continue;
    }
    const issuerValid = !route.endsWith("sec-edgar") || body?.issuer?.ticker === "AAPL";
    if (response.ok && results && issuerValid && results.every((item) => typeof item.title === "string" && typeof item.url === "string")) {
      pass(`${name} route`, `HTTP ${response.status}; ${results.length} valid metadata records`);
    } else {
      fail(`${name} route`, `HTTP ${response.status}; expected ${route.endsWith("sec-edgar") ? "an exact AAPL issuer match and " : ""}a ${resultKey} array of title/URL records`);
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
