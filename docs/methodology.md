# Atlas methodology

Atlas is a search-first tool for comparing what a bounded sample of public market conversations says in an English-language baseline and a selected country-language/community lens. The country selector changes the query language and relevant public communities. It does **not** verify a writer's location, nationality, or investor status. The English baseline is not a verified United States sample either.

## Focused retrieval

The default search uses public Bluesky search, selected public Lemmy instances, and public Mastodon hashtag timelines. Provider query, language parameter, retrieval time, time window, raw-return count, exclusions, and failure status are retained per source. Mastodon hashtags miss untagged posts; Lemmy federation can repeat one original across servers; Bluesky search is an incomplete index. The selected country lens searches only its configured instances, not every available server. A missing match or timed-out provider is a coverage limit, not evidence that a view is absent.

The current default does not query title-only literature, Stack Exchange Q&A, play-money forecasts, software forums, or headline feeds. These sources cannot by themselves establish a current country-community perspective. Their old adapters and policy documentation may remain for operator review, but they do not contribute to the focused result. Reddit is excluded under its research API policy. SEC requests are disabled by operator policy.

Explicit currency, inflation/GDP/unemployment, and energy topics may show separately labeled official ECB, BIS, World Bank, or EIA observations where configured and applicable. Each has its own observation date, unit, attribution, and freshness limit. These are not current conversation, country opinion, executable prices, or AI discussion inputs. EIA requires an operator-held free registered key; no key is sent to the browser.

## Evidence selection and comparison

Atlas first applies transparent topic-term and market-language screens, source-safety exclusions, and duplicate/near-copy checks. The overview uses at most eight short public discussion excerpts per side, balanced by platform and displayed account. Linked reposts, explicitly attributed reporting, high-confidence promotional posts, and identifiable household purchase/utility-bill advice remain inspectable as source records but do not support an independent-discussion overview. These conservative screens can miss relevant synonyms or subtle promotion; they are not semantic truth tests.

The result explicitly says **not enough evidence to compare** if either side has no qualifying excerpts. It says **limited comparison** if either side has fewer than three selected excerpts or fewer than two platforms. A cross-community label means multiple selected excerpts and platforms, not national representativeness or agreement. Platform counts and retrieved-record counts must never be interpreted as prevalence, market share, or investor sentiment.

When a privately configured free-tier model is available, Atlas asks it to produce short claims from the selected excerpts and to quote exact supporting substrings. The server validates citation IDs, group membership, quote matches, and numeric consistency, then performs a second same-provider model review. That review is correlated model judgment, not independent verification; an unsupported or unavailable draft is withheld. When AI is unavailable, the product shows labeled direct evidence excerpts instead. Author handles and original URLs are not sent to the model. See the public privacy page for provider-specific data handling.

The overview and dated official context appear first. Each claim's citations and verbatim quotes are collapsed; opening a citation reveals its original source record. The complete source register, including coverage gaps and query provenance, is also collapsed by default. A source link establishes where an excerpt came from, not that the excerpt is true, financially material, or predictive.

## Research-quality boundary

Atlas is discovery, not a completed investment thesis, sentiment index, or recommendation. It does not replace filings, financial statements, valuation work, independent translation, or original-source inspection. A numeric research-quality rating requires reviewed multilingual searches, relevance and link checks, provider-status accuracy, and claim-level human adjudication. Local tests and synthetic reviewer fixtures do not satisfy that empirical acceptance requirement.
