# Atlas research-quality smoke check

This is a dated operational spot-check, not a benchmark of representativeness, predictive value, or investment performance. It records counts only; no post text or author handles were copied into the report.

## Live public API sample

Run: 2026-10-11 07:45 UTC. The queries below were sent directly to the public provider adapters. `complete` means the API request succeeded; it does not mean the returned items are representative or that the query is semantically unambiguous.

| Provider and request | Status | Accepted records | What this demonstrates—and does not |
| --- | --- | ---: | --- |
| Bluesky search `semiconductor` | Complete | 25 | The current public index returned its 25-record cap. It is not a count of all discussion or people. |
| Bluesky search `CAT` | Complete | 19 | A ticker-like/common-word query returns records without identifying the entity. Atlas now displays an ambiguity warning and an explicit optional Caterpillar expansion; these 19 records are not labeled Caterpillar-specific. |
| Bluesky search `atlas-qzv-947281` | Complete, zero results | 0 | Confirms that a successful empty response is distinct from an unavailable provider. It does not establish absence. |
| Lemmy `lemmy.world`, `semiconductor` | Complete | 8 | Current API-indexed public posts passed the adapter's seven-day, removal, bot, and URL filters. One server is not a global or national sample. |
| Lemmy `lemmy.world`, `반도체` | Complete, zero results | 0 | The Korean-language query completed but returned no accepted records on this server. This is not evidence that Korean discussion is absent. |
| Mastodon public hashtag timeline, `#semiconductor`, `mastodon.social` | Complete | 20 | The adapter returned its 20-post cap. Hashtag-only coverage misses untagged discussion. |
| Mastodon public hashtag timeline, `#반도체`, `mastodon.social` | Complete | 20 | A Korean hashtag returned records, but the instance and language do not verify contributor geography. |

The responses are provider-specific and not comparable as raw counts: Bluesky searches indexed text, Lemmy searches forum posts, and Mastodon searches a hashtag timeline. Their ranking, membership, freshness, and ceilings differ.

### Supplemental Lemmy-instance check

Run: 2026-10-11 07:52 UTC. The same live adapter searched `semiconductor` on two additional instances; it retained no rows outside the transient result and this report records counts only.

| Instance | Status | Accepted records | Interpretation |
| --- | --- | ---: | --- |
| `sopuli.xyz` | Complete | 8 | Recent public API matches after the adapter's 7-day and moderation filters. A Finnish-hosted server is not proof of Finnish authors or views. |
| `sh.itjust.works` | Complete | 7 | Recent public API matches after the same filters. The operator describes this as a bilingual English/French general-purpose instance; it is not a verified Canadian resident sample. |

The additional instances are separately labeled and their rights/operator information is linked from `/sources`. Their federated results may overlap existing instances; they increase server-view coverage, not independent-source count or population coverage.

### The Conversation feed-search check

Run: 2026-10-11 04:03 UTC. The live Atlas adapter queried all six public Atom feeds. Counts below contain no article titles or author details.

| Query | UK | Canada | Africa | New Zealand | Australia | U.S. | Status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `AI` | 1 | 2 | 0 | 3 | 3 | 5 | All six feeds complete |
| `semiconductor` | 0 | 0 | 0 | 0 | 0 | 0 | All six feeds complete |
| `inflation` | 0 | 0 | 0 | 0 | 0 | 0 | All six feeds complete |

These are exact-title matches from one expert-analysis publisher. The edition names do not imply author or audience residence, and an empty query result does not establish that the subject is absent from those editions.

### Crossref and two-lens integration check

Run: 2026-10-11 08:17 UTC, through the local Atlas server routes and public APIs. The search was `semiconductor` for the baseline and `반도체` for the Korean language/community lens. Counts only; no excerpts, DOI titles, author names, or handles are reproduced here.

| Lens | Provider | Status | Accepted records |
| --- | --- | --- | ---: |
| Baseline | Crossref | Complete | 12 |
| Baseline | Bluesky | Complete | 25 |
| Baseline | Lemmy · `lemmy.world` | Complete | 8 |
| Baseline | Mastodon · `mastodon.social` hashtag | Complete | 20 |
| Baseline | The Conversation · six editions | Complete | 0 across all editions |
| Korean query | Bluesky | Complete | 21 |
| Korean query | Mastodon · `mastodon.social` hashtag | Complete | 20 |
| Korean query | Lemmy · six configured instances | Complete | 0 across all instances |
| Korean query | Global Voices · twelve editions | Complete | 0 across all editions |

Crossref returned 12 DOI-linked records whose publication dates passed the adapter's five-year cutoff. It was queried once for the baseline and was not treated as a U.S. view, Korean view, community post, or AI-summary input. `Complete` indicates the bounded API call succeeded and says nothing about representativeness, independence, or source coverage beyond that request. This is a one-time live snapshot, not a performance or recall benchmark.

### arXiv metadata route check

Run: 2026-10-11 08:23 UTC, via the local Atlas server endpoint, query `semiconductor`. The public API request completed and the adapter returned five records. All links passed the `arxiv.org/abs/` host/path check; the returned objects contained no abstract or author fields. This is a technical integration check of one query, not a measure of arXiv coverage or the quality of the papers.

### Broader topic and language check

Run: 2026-10-11 08:46 UTC, by running the same live adapters without the AI summarizer and recording counts only. Topic: `bitcoin`; localized probes: Korean `비트코인` and Spanish-language `bitcoin`. No excerpts, titles, author handles, or URLs were retained here.

| Lens/query | Bluesky | Lemmy (six server views) | Mastodon hashtag | Global Voices |
| --- | ---: | ---: | ---: | ---: |
| English · `bitcoin` | 24 | 14–20 per server | 20 (cap) | 0 |
| Korean · `비트코인` | 11 | 0 across all six | 18 | 0 |
| Spanish-language phrase · `bitcoin` | 24 | 14–20 per server | 20 (cap) | 0 |

This validates that the public adapters can return live records on multiple providers and that the Korean phrase has coverage on Bluesky and a Japanese-hosted Mastodon instance while this particular term returned no Lemmy matches. It does not validate language purity, local author geography, relevance to investor thesis, independent authorship, or representation. English and Spanish rows intentionally share the same query, so their identical counts are not evidence of Spanish-language coverage. The Mastodon count is at its cap and queries only a hashtag timeline. The six Lemmy counts are separate, potentially overlapping federated server views, not six independent samples.

### Production release check

Run: 2026-10-11 08:28 UTC against `https://signal-scout-xi-ruby.vercel.app` after commit `f403515` was pushed to `main` and the deployment updated. The production verifier passed all 21 checks, including public routes, protected operational endpoints, and the new source APIs. Its live query `electric vehicles` returned 12 Crossref records and 10 arXiv records with title/URL fields. A separate live `semiconductor` request returned HTTP 200 from The Conversation (six editions, zero title matches) and Global Voices (twelve editions, zero title matches); the `/sources` register displayed all three providers plus Crossref and arXiv. Successful empty results are not evidence of topic absence. This verifies deployment and bounded endpoint operation only—not relevance precision, recall, coverage, representativeness, or the 8/10 quality bar.

### Manual rendered-result spot check

Run: 2026-10-11 07:13 UTC, read-only inspection of an already-rendered production search for `coffee` with the Brazil/Portuguese lens. The summary's cited observations corresponded to casual/lifestyle excerpts, but the retrieved record set also included fiction, advertisements, affiliate promotions, and exact federated Lemmy copies. This is a useful failure case: topical mention alone is not a fundamental-research market view. Commit `e3fb4d9` strengthened the summarizer instructions with a concrete coffee example and requires it to say when evidence does not establish a market thesis. The follow-up below tests one controlled negative example; it does not establish reliability on real samples or other topics.

Follow-up: 2026-10-11 08:36 UTC, one production request through `/api/research/market-assist` using four synthetic, link-free lifestyle excerpts (no real posts, handles, or URLs). The deployed model returned HTTP 200 and explicitly said that neither lens supplied market-relevant evidence and that no market thesis could be drawn; all three passages cited only the submitted IDs. This validates the safeguard on a controlled negative example, not its reliability on real-world samples or other languages/topics. A second production request using four short redacted excerpts from the observed public coffee sample returned HTTP 503 with `mode=unavailable`; no provider cause was exposed, so it cannot be attributed specifically to quota exhaustion. Atlas's client falls back to its local evidence overview when this occurs. Real-world summary adherence therefore remains unverified.

Follow-up: 2026-10-11 08:40 UTC, commit `94729e8` added sanitized failure categories (`rate-limited`, `timeout`, `provider-error`, `invalid-response`, `citation-validation`, `disabled`, and Atlas's separate per-client request limit) to the local-overview explanation. Raw provider error text is never returned. Automated tests cover provider 429, Atlas request limiting, and citation validation; 351 tests, standalone typecheck, and production build pass. The post-push production verifier again passed 21/21 checks. This makes failure handling observable but does not prove that the free provider will remain available or that summaries are reliable across live topics.

## Failure and product checks

- Automated test simulation: a Bluesky HTTP 429 is labeled unavailable while a successful zero-result Wikimedia response remains complete. This verifies partial-failure handling; it is not a live outage test.
- Automated tests also cover selected language lenses, exact query snapshots, explicit user query alternatives, CC BY-SA title-only Stack Exchange evidence, attribution, overlap flags, source-status distinctions, and citation validation.
- Stack Exchange repeated identical phrase/site searches are reused for 65 seconds in the current browser session. The adapter honors API-provided backoff and surfaces the latest `quota_remaining` value returned by the API. This local cache is not a shared, cross-user quota coordinator.
- Production smoke check on 2026-10-11: 21/21 checks passed after commit `f403515` was deployed. It verified the search-first landing, source register, retired-route redirects, protected operational endpoints, and live Crossref/arXiv query responses. No paid-model call was made, and the check does not certify live search completeness.

## Remaining validation limits

The alias dictionary is intentionally small and cannot resolve every ticker, local company name, homonym, or language-specific alias. Alias suggestions require an explicit user click and start a new exact-phrase search. The live sample is a one-time check that can change at any moment; it does not establish country-level representation, unique authors, genuine investor identity, independent corroboration, persistent qualified leads, or an investment edge. Production searches, broader time-window studies, and researcher review are still needed before assigning an 8/10 quality score.
