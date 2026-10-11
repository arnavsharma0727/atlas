# Launch and counsel review checklist

This document records product questions that need a qualified reviewer. It is not legal advice, a legal opinion, or a statement that any source has granted Atlas a license. Product counsel should review these questions before Atlas enables broader collection, user signup, public sharing, translations, or monetization.

## Current operational posture

- Collection is enabled only on individual server-side source flags. A successful HTTP response is not source permission.
- On-demand Explore queries are visitor-triggered. Bluesky, Lemmy, Mastodon, and Stack Exchange requests go from the visitor's browser to their public APIs; Global Voices and The Conversation are routed through bounded, no-store Atlas endpoints that fetch only fixed publisher APIs/feeds. Search results are transient and not written to visitor history. The optional research brief contains only visitor-selected citations and user-written notes and autosaves in that browser's local storage; it is not synced to Atlas's server unless the visitor explicitly saves to an account. Markdown is exported locally only after the visitor requests it. It omits Mastodon post text, Lemmy post bodies, and Wikimedia snippets. Candidate-topic handoffs use a URL fragment, which Explore clears before the next search. Do not add cross-device sync, public sharing, or quoted content without a separate source-rights and privacy review.
- Do not scrape Naver, Toss, DC Inside, Kakao/Daum Cafe, or other communities; do not bypass access controls or use undocumented endpoints.
- Atlas is a public, non-authenticated research prototype. It stores source titles, excerpts/comment text, URLs, timestamps, domains, market/language labels, and some API-returned public metadata in Supabase.
- There is no automated retention/expiration schedule. Migration 0012 adds a protected operator-only hard-delete endpoint for verified individual takedowns; it deletes source text and directly linked evidence/derived records, and prevents re-ingestion with SHA-256 fingerprints. Fingerprints and a content-free audit record remain until an operator removes them under an approved schedule. The deletion workflow does not itself establish a lawful retention period or provide public request intake.
- Google News redirect items are excluded from public pages; no direct Korean publisher or Korean community source is configured.
- Hacker News collection is fail-closed pending both collection and reuse/display approval; historical HN records remain stored but are withheld from the UI and metrics while rights and retention are reviewed. The official HN API exposes public data, but the current YC Terms of Use restrict commercial use and separately restrict copying/distribution/derivative use of site content absent authorization. Counsel should determine whether the API use and public display of excerpts/links in this app are authorized. Do not market HN coverage as representative or use it without explicit clearance.
- Kakao/Daum Cafe Search is disabled. Its free request quota does not override the Kakao Developer Terms/Operating Policy prior-approval restriction on publishing, translating, or otherwise providing service data.
- Reddit is excluded from Atlas research search and is not scraped. Reddit's current developer guidance states that developer APIs/tools are not the authorized avenue for research and directs researchers to the separate Reddit for Researchers program. Reconsider only after Atlas is eligible for, and receives, that program's authorization and its requirements can be implemented. Ordinary API registration, public availability, or free quota is insufficient.
- YouTube Data API comments are only a candidate source, not a forum substitute or cleared feed. Its current default quota is limited, returned data has a 30-day refresh/deletion requirement, and derived analytics require an explicitly approved analytics use case/amendment and compliance review. No API project/key, policy acceptance, or audit request has been created.
- MOIS is limited to policy-context records whose item page has a qualifying open-license notice; it must not be described as investor conversation.
- Wikimedia talk-page search is visitor-triggered and transient. Text reuse generally follows CC BY-SA 4.0/GFDL, with project and imported-content exceptions; the UI links the source talk page and its history for attribution. Search snippets may be old even when a page was edited recently. Keep this separate from general forums, audience metrics, persisted records, and leads unless a source-specific review establishes a defensible use.
- No paid source, translation, model, market-data feed, billing account, or card has been enabled for this work.
- Auth and user watchlists are deployed in code but disabled. Production currently has zero Auth users and zero watchlist rows. Public sharing is not implemented.
- Automatic record expiration remains absent. The operator takedown endpoint and required production migration are configured; the 2026-10-06 production check confirmed unauthenticated requests are rejected with HTTP 401. The credentialed deletion path has not been exercised against a real request. Do not infer an approved retention period from current database behavior.

## Decisions required before launch or source enablement

1. For each source, may Atlas query, store, normalize, display short text excerpts, create aggregate counts, and expose source links to unauthenticated visitors? Which activities require written permission or attribution wording?
2. Do YC/Hacker News terms authorize this product's API-derived public excerpts and aggregate analysis, particularly if the project later becomes commercial? What content, if any, should be removed pending review?
3. What source-specific maximum retention periods and deletion/synchronization obligations apply? Should the system store only IDs, URLs, and counts rather than post text or usernames?
4. What privacy obligations apply when source results contain handles or other personal data, including requests by a source author to remove an item from Atlas?
5. What Korean privacy, copyright, database-right, cross-border transfer, and platform terms apply to collection, storage, processing, and display of Korean-language forum/news content in a U.S.-hosted service?
6. Does any planned scoring, alerts, or product description create investment-adviser, broker, financial-promotion, or other regulated-activity concerns? Keep the product descriptive and non-personalized unless reviewed.
7. Which user-facing terms, privacy notices, retention disclosures, takedown process, and operator contact process are required before sharing beyond a small private test?
8. For personal/community data: what identifiers and user-generated content may be collected, whether minimization or pseudonymization is required, and what notice/consent is appropriate?
9. For user accounts: privacy notice scope, account/data deletion, operational access, breach response, and any applicable cross-border processing terms for Supabase/Vercel.
10. For future translations or derived summaries: source-specific permission, retained originals, machine-translation disclosure, accuracy review, and user correction/takedown process.
11. For public video comments: does the planned cross-market frequency/content analysis qualify under the provider's approved analytics use case, and can the required refresh/deletion obligations be met for text and associated user data?
12. For future alerts, prices, or flows: delivery consent, financial-data licensing/redistribution terms, and whether product presentation creates regulatory or other obligations.

## Engineering follow-up

- Establish source-specific expiration and deletion jobs only after the approved retention schedule is written to `docs/SOURCES.md` and implemented as testable connector policy.
- Add an auditable takedown path that suppresses content immediately and deletes or retains only the minimum required provenance according to counsel's direction.
- Before public Auth signup, configure a production email/OAuth provider, publish the corresponding privacy disclosures, and complete two-account isolation tests.
- Keep sources fail-closed whenever a permission, terms, retention, or attribution decision is unresolved.

## Operational release gates

- No Kakao, Reddit, Naver, Toss, DC Inside, or third-party publisher RSS connector may be enabled until source-specific access, reuse, attribution, rate, retention, and deletion terms are recorded in [`SOURCES.md`](SOURCES.md). The European Commission Presscorner feed is the reviewed exception: only EU-owned titles, links, dates, and attribution metadata are retained under the Commission's CC BY 4.0 default reuse notice; item-level exceptions and third-party works must remain excluded.
- No paid tier, billing wallet, card, or paid overage may be enabled without separate explicit approval. Free quota is not equivalent to a reuse license.
- Before a public launch, obtain a private, reliable user contact channel; implement an intake and response workflow; set source-specific retention/expiration periods; decide retention for takedown fingerprints/audit records; and production-test the operator takedown endpoint. Migration 0012 provides only the protected deletion primitive, not an end-to-end public request process. Indefinite-until-operator-deletes behavior remains a launch blocker.
- Keep the privacy and methodology pages aligned with actual collection, source coverage, translation, inference, and retention behavior.

## Primary source references

- [Y Combinator Legal / Terms of Use](https://www.ycombinator.com/legal/)
- [Official Hacker News API](https://github.com/HackerNews/API)
- [Kakao Developer Terms](https://developers.kakao.com/terms/en/site-terms-20250304) and [Operating Policy](https://developers.kakao.com/terms/en/site-policies-20250304)
- [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms?hslang=en) and [API access requirements](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data)
