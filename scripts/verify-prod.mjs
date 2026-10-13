const base = (process.env.ATLAS_BASE_URL || "https://signal-scout-xi-ruby.vercel.app").replace(/\/$/u, "");
let failed = 0;
let passed = 0;
async function check(name, action) {
  try {
    const ok = await action();
    if (!ok) throw new Error("unexpected response");
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

for (const path of ["/", "/explore", "/sources", "/methodology", "/privacy", "/contact"]) {
  await check(`public page ${path}`, async () => (await fetch(`${base}${path}`, { redirect: "manual" })).status === 200);
}
await check("search-first landing", async () => {
  const html = await (await fetch(base)).text();
  return html.includes("Search a market, company, or idea") && html.includes("Arnav Sharma") && !html.includes("Bluesky · search");
});
for (const path of ["/api/research/market-assist", "/api/research/official-drivers", "/api/ingest", "/api/metrics/recompute"]) {
  await check(`retired connector ${path}`, async () => (await fetch(`${base}${path}`, { redirect: "manual" })).status === 410);
}
await check("Groq comparison rejects malformed input", async () => {
  const response = await fetch(`${base}/api/compare`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: "x", country: "DE" }) });
  return [400, 503].includes(response.status); // 503 means Groq is deliberately disabled.
});

if (process.env.ATLAS_PROD_LIVE_TOPIC) {
  await check("live Groq browser-search comparison", async () => {
    const response = await fetch(`${base}/api/compare`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: process.env.ATLAS_PROD_LIVE_TOPIC, country: process.env.ATLAS_PROD_LIVE_COUNTRY || "DE" }),
      signal: AbortSignal.timeout(58_000) });
    if (!response.ok) return false;
    const result = await response.json();
    return Array.isArray(result.sources) && result.sources.length > 0 && result.comparison !== null;
  });
}

console.log(`\n${passed}/${passed + failed} checks passed.`);
if (failed) process.exitCode = 1;
