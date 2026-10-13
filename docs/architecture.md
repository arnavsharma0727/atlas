# Atlas: current product

Atlas is a search-first comparison of public evidence about a market topic in the United States and one selected country. The active research path has no direct forum, news, statistics, or social-network connector and no scheduled ingestion. Those former connectors and scripts were removed; historical code and documentation remain recoverable from Git history.

The browser sends the topic and country to `POST /api/compare`. A shared Supabase rate limiter checks the request before any provider call. The server then asks Groq's `openai/gpt-oss-120b` to use built-in browser search and return direct links plus a short comparison. If that model responds with a rate limit, the server tries `openai/gpt-oss-20b` once. The Groq key stays server-side. No model call is made when the key or shared limiter is unavailable.

Atlas validates HTTPS URL shape, removes duplicates and Bluesky links, validates source IDs, and rejects unsupported numerical claims and contrasts without links from both markets. If the browser-search response contains usable links but an invalid comparison, Atlas may spend one additional shared-quota unit on a Groq JSON-mode pass using only those source descriptions. These are structural checks, not verification that a page exists or supports a claim. If an overall comparison still fails, the interface displays Groq's source descriptions with a clear warning and keeps the links collapsed. If Groq finds no usable links, Atlas makes no comparison.

The retained operator takedown endpoint is only for historical records already in Supabase; it does not collect new data. The `/explore` route preserves old links but renders the same search. Retired research, ingestion, and metrics endpoints return HTTP 410. Production checks are `npm test`, `npm run build`, and `npm run verify:prod`.

Free-tier Groq limits and search-provider coverage can cause missing or failed results. Country selection is a search focus, not a representative national view. Atlas does not give investment advice. Check original source pages before relying on any finding.
