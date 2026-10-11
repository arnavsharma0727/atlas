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
  if (response.ok && page.includes("The Engine for Global Markets") && page.includes("Search a market, company, or idea") && page.includes("By: Arnav Sharma UVA30") && page.includes("Search automatically creates an AI summary")) {
    pass("focused Atlas search landing", "brand subtitle, search field, byline, and automatic AI disclosure are rendered");
  } else {
    fail("focused Atlas search landing", `HTTP ${response.status}; expected Atlas brand and search field were not found`);
  }
} catch (error) {
  fail("focused Atlas search landing", error instanceof Error ? error.message : "request failed");
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
