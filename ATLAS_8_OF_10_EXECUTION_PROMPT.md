# Atlas 8/10 Research-Quality Execution Brief

You are the product engineer responsible for improving Atlas, a minimal search engine for current public market conversation. Make it a genuinely useful and trustworthy tool for a fundamental researcher—not by adding features or claiming an investment edge, but by improving the relevance, comparability, transparency, and reproducibility of the evidence it retrieves.

## Target bar

Aim for at least 8/10 on *research-workflow quality* only when the acceptance checks below pass. Do not claim Atlas is an 8/10 investment signal, predictor, representative opinion poll, or proprietary data moat without independent outcome evidence. Keep the product's first screen focused on its single search field and attribution. Preserve free-to-use sources and never add a paid dependency, login-gated source, or access-control workaround.

## Required work

1. **Describe what was actually searched.** Freeze the submitted topic, selected lens, effective query for every source, search/as-of times, source-specific window, returned count, and provider state for each result set. Changing the input after a search must not relabel the existing results. Distinguish complete, partial, unavailable, not searched, and completed-with-zero-results.
2. **Never mislabel geography.** A selected country may select language and named communities/instances only. Do not imply contributors live there or represent a national population. English-language results are not a U.S. sample. Label discussion, expert Q&A, journalism, and institutional evidence separately.
3. **Make query semantics inspectable and controllable.** Show automatic translation distinctly from the phrase entered by the researcher; permit a researcher-provided local-language phrase; never silently broaden a query. State when providers search titles only, hashtags only, or a partial index. Support obvious aliases and ticker/company ambiguity without treating short/common tokens as reliable matches.
4. **Make evidence usable, not just numerous.** Validate relevance against the submitted phrase or an explicitly selected alternative, apply source-appropriate freshness, deduplicate exact and defensibly near-identical copies without deleting their provenance, flag concentrated sources/authors where possible, and never treat API record counts as people, attention, sentiment, or prevalence.
5. **Make synthesis auditable.** Every factual summary claim must map to exact, visible source entries. Separate observation from interpretation, show counterevidence and uncertainty when present, and do not synthesize a consensus from sparse or non-comparable samples. If evidence is insufficient, say so plainly. Keep original citations together after readable overviews.
6. **Prune only after tracing.** Preserve the simple search-first experience. Remove only demonstrably unused or misleading code, routes, labels, and dependencies after checking callers, tests, migrations, user data, and redirects. Do not add tabs, dashboards, trading scores, or unsupported claims.
7. **Protect people and sources.** Use permitted public interfaces, honor source policies and rate limits, minimize retention, keep credentials server-side, and preserve deletion/takedown behavior. Do not fetch private content or send author handles/source URLs to the summarizer.

## Acceptance checks

- Add deterministic tests for exact phrases, common-word/ticker ambiguity, aliases, explicit translated queries, duplicates, stale/future records, provider failures vs empty results, query/result snapshot consistency, and citation-to-claim linkage.
- Exercise a broad topic, an ambiguous ticker/company term, a topic with no matches, one non-English phrase supplied by a researcher, and at least one provider failure. Record the providers and their actual status; never present these checks as evidence of global representativeness.
- Verify that no summary claim can reference an absent citation and that no empty/unavailable source is described as evidence of absence.
- Verify keyboard use, accessible labels, desktop/mobile layout, timestamps, source-category separation, visible query/window/provider coverage, and no misleading geographic wording.
- Run the full tests, typecheck, production build, and production smoke checks where configured. Report exact results and remaining gaps; do not equate a passing build with research validation.

## Delivery format

Implement the highest-impact changes in the existing product, keeping the first screen minimal. Then report: what changed; checks actually run and their results; what still prevents the 8/10 bar; and what real-world evidence would be needed to establish a defensible moat. Do not fabricate test results, provider availability, deployment status, or research performance.
