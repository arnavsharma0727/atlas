# Atlas researcher-acceptance protocol

This protocol is the evidence gate for any claim that Atlas is an 8/10 cross-community fundamental-research discovery tool. Passing tests, a successful API response, a high result count, or a polished summary is not a substitute for this review. Until the measurements below are complete and independently checked, Atlas must not be assigned that score.

## Scope

Evaluate the deployed search workflow—not mocked components—across eight current language/community lenses: English baseline, Korean, Japanese, German, French, Brazilian Portuguese, Hindi, and Spanish. These are search lenses, not verified national populations. The English baseline is not a U.S. sample. Do not phrase a result as a country's view unless contributor geography is independently verified (the current configured providers generally do not verify it).

Use ten varied market topics, selected before testing: two company/issuer topics, two commodities or agricultural inputs, two consumer/industrial product markets, two macro/financial conditions, and two topics chosen by reviewers to expose ambiguity or low-volume coverage. Avoid choosing topics because Atlas already returns strong results. Record the exact baseline and local-language query used; a fluent reviewer must approve each local phrase before search. Run each topic/lens pair three times on separate days to expose freshness and provider variability: 240 searches total.

## Record review

For each search, preserve the app's source-specific raw-return count, accepted-result count, excluded-result count, query text, time, provider status, and lens. Review a deterministic random sample of up to ten results per provider per search; if fewer than ten are returned, review all. Open the original source. Reviewers may record only a source key, result/citation ID, and labels—do not copy post text, author handles, email addresses, or private profile information into the worksheet.

Two reviewers label each sampled result independently. At least one reviewer must be fluent in the language of the item; machine translation alone is not sufficient for relevance or meaning labels. Resolve disagreements with a third reviewer or record them as unresolved. For every item, label: topic match; substantive market relevance; language-label correctness; first-person/community opinion versus linked/reported material; likely promotion/spam; duplicate/near-duplicate of another sampled source; original link accessible; and whether the displayed source/lens wording makes a geographic claim it cannot support.

## Summary review

For each generated overview, label every claim against its cited original sources: citation resolves; exact supporting excerpt is present; excerpt semantically supports the full claim; the text describes a post as a post rather than asserting it as fact; the claim does not infer author nationality/residence from language or server; the comparison cites both searched sides; and material counter-evidence is not omitted when it appears in the sampled evidence. Record unsupported, overstated, contradicted, or geographically overclaimed statements as failures, not as stylistic disagreements.

If AI is unavailable, assess the deterministic overview separately and do not count it as an AI summary. If the result set is empty, label provider status and treat it as a coverage observation only—not proof that the topic or view is absent.

## Minimum acceptance gates

All gates must pass; report sample sizes and confidence intervals alongside rates. Do not pool language results to hide a failing lens.

1. At least 50 independently reviewed result records per language lens, from at least five topics and two separate run dates. Fewer records means that lens is unvalidated, not a pass.
2. Inter-reviewer agreement (Cohen's kappa) of at least 0.70 on topic match, market relevance, and geographic overclaim labels before adjudication. Lower agreement means the rubric or labels are not reliable enough to score Atlas.
3. At least 80% precision for items labeled both on-topic and substantively market-relevant overall, and at least 70% for every language lens. Publish per-provider and per-lens denominators; a source with fewer than 20 reviewed items is “insufficient sample,” not a pass.
4. At least 90% of summary claims are judged semantically supported by their cited source(s), with 100% of citations resolvable and zero unsupported country/nationality claims. Exact quote matching is a structural safeguard and does not itself pass semantic support.
5. At least 90% recall for reviewer-identified duplicates within sampled provider results, and no duplicate source item counted as independent corroboration after Atlas's cross-source deduplication. Report false-positive collapse separately.
6. At least two genuinely distinct community operators contribute usable discussion to 70% of topic/lens runs that have ten or more raw discussion results across configured providers. Multiple instances of one federated network count as one operator. Runs below the threshold must be visibly described as single-platform or thin coverage.
7. Every observed missing, stale, inaccessible, rate-limited, or partial provider state is represented accurately in the UI; zero-result searches are never described as evidence of absence.

These are minimum product gates, not a universal investment-research standard. A passing result would support—not guarantee—an 8/10 rating for this bounded use case. Investment performance, causal inference, and representativeness require different studies and are outside this protocol.

## Evidence package

Keep the completed worksheet, anonymized aggregate results, reviewer qualifications by language (not names unless they consent), disagreements/adjudications, exact deployed commit, run dates, source statuses, and any failures. Do not publish or commit source excerpts, account handles, or private personal information. Report each gate as pass, fail, or insufficient sample. A rating is permitted only after all gates pass on the same deployed version and an independent researcher signs off on the interpretation.

The blank [review worksheet](researcher-acceptance-review.csv) contains no user-content fields and is safe to commit. It is an evaluation aid, not acceptance evidence.
