# Atlas

The Engine for Global Markets. Atlas is a focused, AI-assisted market-comparison search: enter a market topic, choose a country, and compare source-backed U.S. and selected-market evidence. The first screen is only the search control and byline; source links stay behind one disclosure.

## Active research path

Atlas normally uses one Groq browser-search call to find public source pages and draft a short comparison for the U.S. and selected market. On a provider rate-limit response, it may retry once on Groq's other supported free-tier model. If links are found but the comparison fails validation, one additional quota-counted Groq call may summarize only those source descriptions. The server accepts only HTTPS links, rejects unrecognized citation IDs, and withholds an unsupported comparison. This is **not** independent verification: source pages, dates, snippets, country relevance, and AI interpretations can be wrong. Open the original links. The prior direct Bluesky/forum/statistics integrations and scheduled ingestion are removed from the active product; retired server endpoints return HTTP 410.

The U.S. is the baseline. Country selection is a research focus, not a survey of residents or investors. No investment recommendation, price target, or representative national sentiment is inferred.

## Run locally

```bash
npm install
npm run dev
```

Use `.env.example` as a reference for a private `.env.local`; do not overwrite an existing local file or commit secrets. Set a Groq **free-tier** key and `GROQ_FREE_TIER_ENABLED=true`. Production values belong in private Vercel environment variables. The existing Supabase URL and service-role key are needed only for the shared server-side usage limiter. Without that limiter, AI requests fail closed rather than exposing an unrestricted key. Groq browser search requires a supported GPT-OSS model; Atlas uses `openai/gpt-oss-120b` first and tries `openai/gpt-oss-20b` only if the first model reports a rate limit. Free usage can still run out; no billing is enabled by Atlas. Browser search is not compatible with Groq structured outputs, so Atlas parses and validates its response after generation.

```bash
npm test
npm run typecheck
npm run build
```

See the live [sources](https://signal-scout-xi-ruby.vercel.app/sources), [methodology](https://signal-scout-xi-ruby.vercel.app/methodology), and [privacy](https://signal-scout-xi-ruby.vercel.app/privacy) pages for the current workflow.
