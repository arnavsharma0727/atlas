# Atlas

**The Engine for Global Markets**

Atlas is a lean research tool for comparing public market discussion across an English-language baseline and a selected country-language/community lens. It presents a short evidence-bound overview, applicable dated official context, and original sources behind disclosures. It is not a polling service, sentiment score, or investment recommendation.

## What a search covers

The focused search queries Bluesky, relevant public Lemmy servers, and public Mastodon hashtag timelines. Topic-applicable ECB/BIS currency, World Bank macro, and optional EIA energy observations are shown separately with dates and units; they are never treated as opinions. The default search no longer queries title-only literature, specialist Q&A, play-money forecasts, or software forums. The English baseline applies Bluesky's `en` language filter; the selected lens uses its own language filter and an automatically translated phrase when an enabled AI provider is available. Without translation it displays that limit and allows a researcher-entered local phrase. Exact queries, source status, and windows remain inspectable in the collapsed source register.

Provider coverage and search behavior differ. An empty result does not establish that a topic is absent. Counts are returned records, not unique people, market attention, or prevalence. Country selections are language/community lenses, never verified contributor geography. Atlas marks comparisons insufficient or limited when the selected evidence is too thin. It attempts an AI overview using a small source-balanced excerpt set and keeps supporting quotes and citations one click away. Optional Groq and Gemini providers are configured privately; if neither is available or a draft fails checks, Atlas shows a labeled rule-based evidence overview. Neither output is a national opinion estimate or investment recommendation.

Atlas does not establish a U.S. sample, representative country-level opinions, validated sentiment, source independence, financial materiality, or an investment thesis. Use it to discover questions and inspect original sources—not as a substitute for filings, financial statements, valuation work, or independent verification.

## Run locally

```bash
npm install
npm run dev
```

Use a private `.env.local` for local server configuration. Never commit it. Production secrets belong in Vercel environment settings. See [deployment](docs/deployment.md), [sources](docs/data-sources.md), and [methodology](/methodology).

## Architecture

The search UI calls bounded public-source adapters. Optional private operational endpoints remain protected server-side. Search queries and live result sets are transient and are not stored by the search UI.

## Development and verification

```bash
npm test
npm run typecheck
npm run build
npm run verify:prod
```

The production verification script checks deployed routes and data/release conditions without printing credentials. It may report unmet gates; it does not invent data to pass them.

Research quality is a separate, currently unvalidated gate. `npm run evaluate:acceptance` evaluates the anonymized review worksheets described in [the acceptance protocol](docs/researcher-acceptance-protocol.md). Empty worksheets return “insufficient,” not a passing rating. Unit-test fixtures are synthetic and are never acceptance evidence.

## Scope and safety

Public online activity is not necessarily representative or financially material. Do not scrape sites, bypass access controls, or display content beyond applicable source terms. Consult the [source register](https://signal-scout-xi-ruby.vercel.app/sources), [privacy notice](https://signal-scout-xi-ruby.vercel.app/privacy), and [methodology](https://signal-scout-xi-ruby.vercel.app/methodology) before interpreting results.
