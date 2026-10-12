# Atlas

**The Engine for Global Markets**

Atlas is a focused search engine for current public conversations and reporting about a market interest. Search results begin with separate language/source highlights; original links and provider details are grouped afterward. It is not a financial-data terminal, polling service, sentiment model, or investment recommendation system.

## What a search covers

The live search queries Bluesky, public Lemmy instance APIs, and public Mastodon hashtag timelines; it also checks recent, individually licensed Stack Exchange Q&A. A non-U.S. language/community lens additionally searches Global Voices headline metadata across localized editions. For explicit FX/currency topics, a keyless BIS endpoint adds official effective-exchange-rate indices as separately labeled context. Reporting, expert Q&A, official statistics, and social discussion remain distinct evidence classes. The English baseline adds a `lang:en` filter to Bluesky; Lemmy uses the submitted phrase as entered, and Mastodon searches mechanically generated hashtags. The selected lens automatically attempts AI query translation when Groq is configured server-side; otherwise it uses the original phrase and offers a local-language override. Exact provider queries and windows are displayed with results. Hacker News is retired from visitor search pending content reuse review.

Provider coverage and search behavior differ. An empty result does not establish that a topic is absent. Counts are returned records, not unique people, market attention, or prevalence. Country selections are language/community lenses, never verified contributor geography. On search, Atlas automatically attempts an AI overview using a small, source-balanced set of returned excerpts and links each passage to supporting records; the privacy notice describes the topic/excerpt transfer to Groq. If the operator has not enabled/configured Groq or the provider is unavailable, the app displays a rule-based evidence overview. Neither is a national opinion estimate or investment recommendation.

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
