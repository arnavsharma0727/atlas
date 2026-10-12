export type BinaryLabel = "yes" | "no" | "";

export type AcceptanceSourceRow = {
  run_id: string;
  run_date_utc: string;
  deployed_commit: string;
  topic_label: string;
  baseline_query: string;
  local_query: string;
  selected_lens: string;
  provider_key: string;
  source_operator_key: string;
  is_community_discussion: BinaryLabel;
  provider_status: string;
  ui_status_accurate: BinaryLabel;
  raw_returned_count: string;
  accepted_count: string;
  excluded_count: string;
};

export type AcceptanceResultRow = {
  run_id: string;
  selected_lens: string;
  topic_label: string;
  provider_key: string;
  source_operator_key: string;
  result_id: string;
  atlas_included: BinaryLabel;
  atlas_summary_included: BinaryLabel;
  atlas_duplicate_flagged: BinaryLabel;
  reviewer_1_fluent: BinaryLabel;
  reviewer_2_fluent: BinaryLabel;
  reviewer_1_topic_match: BinaryLabel;
  reviewer_2_topic_match: BinaryLabel;
  adjudicated_topic_match: BinaryLabel;
  reviewer_1_market_relevance: BinaryLabel;
  reviewer_2_market_relevance: BinaryLabel;
  adjudicated_market_relevance: BinaryLabel;
  reviewer_1_geography_overclaim: BinaryLabel;
  reviewer_2_geography_overclaim: BinaryLabel;
  adjudicated_geography_overclaim: BinaryLabel;
  adjudicated_original_opinion: BinaryLabel;
  adjudicated_promotion_or_spam: BinaryLabel;
  adjudicated_language_correct: BinaryLabel;
  source_link_accessible: BinaryLabel;
  adjudicated_duplicate: BinaryLabel;
  adjudicated_duplicate_group: string;
};

export type AcceptanceClaimRow = {
  run_id: string;
  selected_lens: string;
  claim_id: string;
  claim_type: "overview" | "comparison" | string;
  reviewer_1_fluent: BinaryLabel;
  reviewer_2_fluent: BinaryLabel;
  reviewer_1_citation_resolves: BinaryLabel;
  reviewer_2_citation_resolves: BinaryLabel;
  reviewer_1_exact_quote_present: BinaryLabel;
  reviewer_2_exact_quote_present: BinaryLabel;
  reviewer_1_semantic_support: BinaryLabel;
  reviewer_2_semantic_support: BinaryLabel;
  adjudicated_semantic_support: BinaryLabel;
  reviewer_1_describes_post_as_post: BinaryLabel;
  reviewer_2_describes_post_as_post: BinaryLabel;
  adjudicated_describes_post_as_post: BinaryLabel;
  reviewer_1_unsupported_geography: BinaryLabel;
  reviewer_2_unsupported_geography: BinaryLabel;
  adjudicated_unsupported_geography: BinaryLabel;
  adjudicated_comparison_cites_both_sides: BinaryLabel;
  adjudicated_counterevidence_omitted: BinaryLabel;
};

export type Proportion = {
  numerator: number;
  denominator: number;
  rate: number | null;
  confidence95: [number, number] | null;
};

export type AcceptanceGate = {
  id: number;
  name: string;
  status: "pass" | "fail" | "insufficient";
  detail: string;
};

const REQUIRED_LENSES = ["English", "Korean", "Japanese", "German", "French", "Portuguese", "Hindi", "Spanish"] as const;

/** Compute auditable evidence gates from reviewer labels; never reads or needs post text or author data. */
export function evaluateResearchAcceptance(input: {
  sources: AcceptanceSourceRow[];
  results: AcceptanceResultRow[];
  claims: AcceptanceClaimRow[];
}) {
  const { sources, results, claims } = input;
  const integrity = inspectEvidenceIntegrity(sources, results, claims);
  const runIds = new Set(sources.map((row) => row.run_id).filter(Boolean));
  const uniqueTopics = new Set(sources.map((row) => row.topic_label).filter(Boolean));
  const datesByTopicLens = new Map<string, Set<string>>();
  for (const row of sources) {
    const date = row.run_date_utc.slice(0, 10);
    const topicLens = `${row.topic_label}\u0000${row.selected_lens}`;
    const days = datesByTopicLens.get(topicLens) ?? new Set<string>();
    if (date) days.add(date);
    datesByTopicLens.set(topicLens, days);
  }

  const acceptedResults = results.filter((row) => row.atlas_included === "yes");
  const unclassifiedResultRows = results.filter((row) => !isBinary(row.atlas_included)).length;
  const unadjudicatedPrecisionRows = acceptedResults.filter((row) => !isBinary(row.adjudicated_topic_match) || !isBinary(row.adjudicated_market_relevance)).length;
  const sampleByLens = new Map<string, AcceptanceResultRow[]>();
  const sampleByProvider = new Map<string, AcceptanceResultRow[]>();
  for (const row of acceptedResults) {
    pushMap(sampleByLens, row.selected_lens, row);
    pushMap(sampleByProvider, row.provider_key, row);
  }
  const precision = (rows: AcceptanceResultRow[]): Proportion => {
    const reviewed = rows.filter((row) => isBinary(row.adjudicated_topic_match) && isBinary(row.adjudicated_market_relevance));
    return proportion(reviewed.filter((row) => row.adjudicated_topic_match === "yes" && row.adjudicated_market_relevance === "yes").length, reviewed.length);
  };
  const overallPrecision = precision(acceptedResults);
  const precisionByLens = Object.fromEntries(REQUIRED_LENSES.map((lens) => [lens, precision(sampleByLens.get(lens) ?? [])]));
  const providerKeys = new Set([...sources.map((row) => row.provider_key), ...sampleByProvider.keys()].filter(Boolean));
  const precisionByProvider = Object.fromEntries([...providerKeys].map((provider) => [provider, precision(sampleByProvider.get(provider) ?? [])]));

  const fluentResults = results.filter((row) => row.reviewer_1_fluent === "yes" || row.reviewer_2_fluent === "yes");
  const unfluentResults = results.length - fluentResults.length;
  const kappas = {
    topicMatch: cohenKappa(fluentResults, "reviewer_1_topic_match", "reviewer_2_topic_match"),
    marketRelevance: cohenKappa(fluentResults, "reviewer_1_market_relevance", "reviewer_2_market_relevance"),
    geographyOverclaim: cohenKappa(fluentResults, "reviewer_1_geography_overclaim", "reviewer_2_geography_overclaim"),
  };
  const kappaDenominators = {
    topicMatch: pairedBinaryLabelCount(fluentResults, "reviewer_1_topic_match", "reviewer_2_topic_match"),
    marketRelevance: pairedBinaryLabelCount(fluentResults, "reviewer_1_market_relevance", "reviewer_2_market_relevance"),
    geographyOverclaim: pairedBinaryLabelCount(fluentResults, "reviewer_1_geography_overclaim", "reviewer_2_geography_overclaim"),
  };

  const fluentClaims = claims.filter((row) => row.reviewer_1_fluent === "yes" || row.reviewer_2_fluent === "yes");
  const supportedClaims = claims.filter((row) => row.adjudicated_semantic_support !== "");
  const semanticSupport = proportion(supportedClaims.filter((row) => row.adjudicated_semantic_support === "yes").length, supportedClaims.length);
  const resolvedCitationLabels = claims.flatMap((row) => [row.reviewer_1_citation_resolves, row.reviewer_2_citation_resolves]).filter(isBinary);
  const citationResolution = proportion(resolvedCitationLabels.filter((label) => label === "yes").length, resolvedCitationLabels.length);
  const exactQuoteLabels = claims.flatMap((row) => [row.reviewer_1_exact_quote_present, row.reviewer_2_exact_quote_present]).filter(isBinary);
  const exactQuotePresence = proportion(exactQuoteLabels.filter((label) => label === "yes").length, exactQuoteLabels.length);
  const postAttributionReviewed = claims.filter((row) => row.adjudicated_describes_post_as_post !== "");
  const postAttributionAccuracy = proportion(postAttributionReviewed.filter((row) => row.adjudicated_describes_post_as_post === "yes").length, postAttributionReviewed.length);
  const geographyReviewed = claims.filter((row) => row.adjudicated_unsupported_geography !== "");
  const unsupportedGeography = proportion(geographyReviewed.filter((row) => row.adjudicated_unsupported_geography === "yes").length, geographyReviewed.length);
  const comparisonClaims = claims.filter((row) => row.claim_type === "comparison");
  const comparisonSides = proportion(comparisonClaims.filter((row) => row.adjudicated_comparison_cites_both_sides === "yes").length, comparisonClaims.length);
  const counterevidenceReviewed = claims.filter((row) => row.adjudicated_counterevidence_omitted !== "");
  const counterevidenceOmissions = proportion(counterevidenceReviewed.filter((row) => row.adjudicated_counterevidence_omitted === "yes").length, counterevidenceReviewed.length);
  const claimCoverageByLens = Object.fromEntries(REQUIRED_LENSES.map((lens) => {
    const lensClaims = claims.filter((row) => row.selected_lens === lens);
    const topicLabels = new Set(lensClaims.map((row) => integrity.runById.get(row.run_id)?.topic_label).filter(Boolean));
    const dates = new Set(lensClaims.map((row) => integrity.runById.get(row.run_id)?.run_date_utc).filter(Boolean));
    const adjudicated = lensClaims.filter((row) => isBinary(row.adjudicated_semantic_support));
    const citationLabels = lensClaims.flatMap((row) => [row.reviewer_1_citation_resolves, row.reviewer_2_citation_resolves]).filter(isBinary);
    const quoteLabels = lensClaims.flatMap((row) => [row.reviewer_1_exact_quote_present, row.reviewer_2_exact_quote_present]).filter(isBinary);
    const geographyLabels = lensClaims.filter((row) => isBinary(row.adjudicated_unsupported_geography));
    const attributionLabels = lensClaims.filter((row) => isBinary(row.adjudicated_describes_post_as_post));
    const counterevidenceLabels = lensClaims.filter((row) => isBinary(row.adjudicated_counterevidence_omitted));
    const comparisons = lensClaims.filter((row) => row.claim_type === "comparison");
    return [lens, {
      claims: lensClaims.length,
      topics: topicLabels.size,
      dates: dates.size,
      semanticSupport: proportion(adjudicated.filter((row) => row.adjudicated_semantic_support === "yes").length, adjudicated.length),
      citationResolution: proportion(citationLabels.filter((label) => label === "yes").length, citationLabels.length),
      exactQuotePresence: proportion(quoteLabels.filter((label) => label === "yes").length, quoteLabels.length),
      unsupportedGeography: proportion(geographyLabels.filter((row) => row.adjudicated_unsupported_geography === "yes").length, geographyLabels.length),
      postAttributionAccuracy: proportion(attributionLabels.filter((row) => row.adjudicated_describes_post_as_post === "yes").length, attributionLabels.length),
      counterevidenceOmissions: proportion(counterevidenceLabels.filter((row) => row.adjudicated_counterevidence_omitted === "yes").length, counterevidenceLabels.length),
      comparisonClaims: comparisons.length,
      comparisonSides: proportion(comparisons.filter((row) => row.adjudicated_comparison_cites_both_sides === "yes").length, comparisons.length),
    }];
  }));
  const claimCoverageSufficient = REQUIRED_LENSES.every((lens) => {
    const coverage = claimCoverageByLens[lens];
    return coverage.claims >= 10 && coverage.topics >= 5 && coverage.dates >= 2 &&
      coverage.semanticSupport.denominator >= 10 &&
      coverage.citationResolution.denominator === coverage.claims * 2 &&
      coverage.exactQuotePresence.denominator === coverage.claims * 2 &&
      coverage.unsupportedGeography.denominator === coverage.claims &&
      coverage.postAttributionAccuracy.denominator === coverage.claims && coverage.counterevidenceOmissions.denominator === coverage.claims &&
      (lens === "English" || (coverage.comparisonClaims > 0 && coverage.comparisonSides.denominator === coverage.comparisonClaims));
  });
  const claimQualityPass = REQUIRED_LENSES.every((lens) => {
    const coverage = claimCoverageByLens[lens];
    return coverage.semanticSupport.rate !== null && coverage.semanticSupport.rate >= 0.90 &&
      coverage.citationResolution.rate === 1 && coverage.exactQuotePresence.rate === 1 &&
      coverage.unsupportedGeography.numerator === 0 &&
      coverage.postAttributionAccuracy.rate === 1 && coverage.counterevidenceOmissions.numerator === 0 &&
      (lens === "English" || coverage.comparisonSides.rate === 1);
  });

  const duplicateItems = results.filter((row) => row.adjudicated_duplicate === "yes");
  const uniqueDuplicateGroups = new Set(duplicateItems.map((row) => `${row.run_id}\u0000${row.adjudicated_duplicate_group}`));
  const duplicateRecall = proportion(duplicateItems.filter((row) => row.atlas_duplicate_flagged === "yes").length, duplicateItems.length);
  const flaggedItems = results.filter((row) => row.atlas_duplicate_flagged === "yes" && isBinary(row.adjudicated_duplicate));
  const duplicateFlagPrecision = proportion(flaggedItems.filter((row) => row.adjudicated_duplicate === "yes").length, flaggedItems.length);
  const unreviewedDuplicateLabels = results.filter((row) => !isBinary(row.adjudicated_duplicate)).length;
  const missingDuplicateGroup = duplicateItems.filter((row) => !row.adjudicated_duplicate_group.trim()).length;
  const duplicateGroupCounts = new Map<string, number>();
  for (const row of duplicateItems) {
    const key = `${row.run_id}\u0000${row.adjudicated_duplicate_group}`;
    duplicateGroupCounts.set(key, (duplicateGroupCounts.get(key) ?? 0) + 1);
  }
  const singletonDuplicateGroups = [...duplicateGroupCounts.values()].filter((count) => count < 2).length;

  const discussionRows = sources.filter((row) => row.is_community_discussion === "yes");
  const rawDiscussionByRun = new Map<string, number>();
  const unknownVolumeRuns = new Set<string>();
  for (const row of discussionRows) if (!isMeasuredCount(row.raw_returned_count)) unknownVolumeRuns.add(row.run_id);
  for (const row of discussionRows) rawDiscussionByRun.set(row.run_id, (rawDiscussionByRun.get(row.run_id) ?? 0) + nonNegativeInt(row.raw_returned_count));
  const highVolumeRuns = new Set([...rawDiscussionByRun].filter(([, count]) => count >= 10).map(([runId]) => runId));
  const uncertainVolumeRuns = [...unknownVolumeRuns].filter((runId) => !highVolumeRuns.has(runId));
  const usableOperatorsByRun = new Map<string, Set<string>>();
  const discussionProviderRuns = new Set(discussionRows.map((row) => `${row.run_id}\u0000${row.provider_key}`));
  for (const row of acceptedResults) {
    if (!discussionProviderRuns.has(`${row.run_id}\u0000${row.provider_key}`) ||
      row.adjudicated_topic_match !== "yes" || row.adjudicated_market_relevance !== "yes" ||
      row.adjudicated_original_opinion !== "yes" || row.adjudicated_promotion_or_spam !== "no" ||
      row.adjudicated_language_correct !== "yes" || row.source_link_accessible !== "yes" ||
      row.adjudicated_duplicate !== "no" || !row.source_operator_key) continue;
    const operators = usableOperatorsByRun.get(row.run_id) ?? new Set<string>();
    operators.add(row.source_operator_key);
    usableOperatorsByRun.set(row.run_id, operators);
  }
  const multiOperatorRuns = [...highVolumeRuns].filter((runId) => (usableOperatorsByRun.get(runId)?.size ?? 0) >= 2).length;
  // A missing upstream count is not zero. Include potentially qualifying runs in
  // the denominator to report a conservative lower bound, never an inflated rate.
  const operatorBreadth = proportion(multiOperatorRuns, highVolumeRuns.size + uncertainVolumeRuns.length);
  if (uncertainVolumeRuns.length) operatorBreadth.confidence95 = null;

  const statusRows = sources;
  const statusAccuracy = proportion(statusRows.filter((row) => row.ui_status_accurate === "yes").length, statusRows.filter((row) => isBinary(row.ui_status_accurate)).length);
  const statusReviewComplete = statusRows.length > 0 && statusRows.every((row) => row.provider_status.trim() && isBinary(row.ui_status_accurate));
  const languageAccuracyByLens = Object.fromEntries(REQUIRED_LENSES.map((lens) => {
    const rows = results.filter((row) => row.selected_lens === lens && row.adjudicated_language_correct !== "");
    return [lens, proportion(rows.filter((row) => row.adjudicated_language_correct === "yes").length, rows.length)];
  }));
  const languageAccuracyPass = REQUIRED_LENSES.every((lens) =>
    languageAccuracyByLens[lens].denominator >= 50 && languageAccuracyByLens[lens].rate !== null && languageAccuracyByLens[lens].rate >= 0.90,
  );
  const sourceLinkAccessibility = proportion(results.filter((row) => row.source_link_accessible === "yes").length, results.filter((row) => isBinary(row.source_link_accessible)).length);
  const unclassifiedResultLabels = results.filter((row) =>
    !isBinary(row.adjudicated_original_opinion) || !isBinary(row.adjudicated_promotion_or_spam) ||
    !isBinary(row.adjudicated_language_correct) || !isBinary(row.source_link_accessible) || !isBinary(row.atlas_summary_included),
  ).length;
  const summaryEvidence = results.filter((row) => row.atlas_summary_included === "yes");
  const summaryEvidenceByLens = Object.fromEntries(REQUIRED_LENSES.map((lens) => {
    const lensRows = summaryEvidence.filter((row) => row.selected_lens === lens);
    const topics = new Set(lensRows.map((row) => integrity.runById.get(row.run_id)?.topic_label).filter(Boolean));
    const dates = new Set(lensRows.map((row) => integrity.runById.get(row.run_id)?.run_date_utc).filter(Boolean));
    const unreviewed = lensRows.filter((row) => !isBinary(row.adjudicated_topic_match) || !isBinary(row.adjudicated_market_relevance) ||
      !isBinary(row.adjudicated_language_correct) || !isBinary(row.adjudicated_original_opinion) || !isBinary(row.adjudicated_promotion_or_spam) || !isBinary(row.adjudicated_duplicate));
    const unsuitable = lensRows.filter((row) => row.atlas_included !== "yes" || row.adjudicated_topic_match !== "yes" || row.adjudicated_market_relevance !== "yes" ||
      row.adjudicated_language_correct !== "yes" || row.adjudicated_original_opinion !== "yes" || row.adjudicated_promotion_or_spam !== "no" ||
      row.atlas_duplicate_flagged === "yes");
    return [lens, { count: lensRows.length, topics: topics.size, dates: dates.size, unreviewed: unreviewed.length, unsuitable: unsuitable.length }];
  }));
  const selectedDuplicateGroups = new Map<string, number>();
  for (const row of summaryEvidence) {
    if (row.adjudicated_duplicate === "yes" && row.adjudicated_duplicate_group.trim()) {
      const key = `${row.run_id}\u0000${row.adjudicated_duplicate_group}`;
      selectedDuplicateGroups.set(key, (selectedDuplicateGroups.get(key) ?? 0) + 1);
    }
  }
  const repeatedSummaryDuplicateGroups = [...selectedDuplicateGroups.values()].filter((count) => count > 1).length;
  const summaryEvidenceCoveragePass = REQUIRED_LENSES.every((lens) =>
    summaryEvidenceByLens[lens].count >= 10 && summaryEvidenceByLens[lens].topics >= 5 && summaryEvidenceByLens[lens].dates >= 2,
  );
  const sourceAccessPrecision = sourceLinkAccessibility;

  const lensCoverage = REQUIRED_LENSES.map((lens) => {
    const rows = results.filter((row) => row.selected_lens === lens);
    const topicCount = new Set(rows.map((row) => integrity.runById.get(row.run_id)?.topic_label).filter(Boolean)).size;
    const dates = new Set(rows.map((row) => integrity.runById.get(row.run_id)?.run_date_utc).filter(Boolean));
    return { lens, reviewedRecords: rows.length, topicCount, dateCount: dates.size };
  });
  const fullSchedule = runIds.size === 240 && uniqueTopics.size === 10 && REQUIRED_LENSES.every((lens) =>
    [...uniqueTopics].every((topic) => (datesByTopicLens.get(`${topic}\u0000${lens}`)?.size ?? 0) >= 3),
  );
  const perLensCoveragePass = lensCoverage.every((lens) => lens.reviewedRecords >= 50 && lens.topicCount >= 5 && lens.dateCount >= 2);
  const validKappas = Object.values(kappas).filter((value): value is number => value !== null);
  const allResultKappaLabelsPresent = unfluentResults === 0 && Object.values(kappaDenominators).every((count) => count === results.length);
  const allPrecisionLensesPass = REQUIRED_LENSES.every((lens) => {
    const metric = precisionByLens[lens];
    return metric.denominator >= 50 && metric.rate !== null && metric.rate >= 0.70;
  });
  const contributingDiscussionProviders = new Set(sources.filter((row) => row.is_community_discussion === "yes" && nonNegativeInt(row.accepted_count) > 0).map((row) => row.provider_key));
  const underSampledProviders = [...contributingDiscussionProviders].filter((provider) => (precisionByProvider[provider]?.denominator ?? 0) < 20);
  const sourceStatusAccurate = statusReviewComplete && statusAccuracy.numerator === statusRows.length;

  const gates: AcceptanceGate[] = [
    gateWithInsufficient(1, "Review coverage", !sources.length || !results.length || unfluentResults > 0 || unclassifiedResultRows > 0 || !perLensCoveragePass || !fullSchedule,
      perLensCoveragePass && fullSchedule,
      `${runIds.size} unique searches across ${uniqueTopics.size} topics; lens records: ${lensCoverage.map(({ lens, reviewedRecords }) => `${lens} ${reviewedRecords}`).join(", ")}. Full schedule: ${fullSchedule ? "yes" : "no"}; results without a fluent reviewer: ${unfluentResults}; results with no inclusion decision: ${unclassifiedResultRows}. Target: 240 searches (10 topics × 8 lenses × 3 dates), then ≥50 records per lens across ≥5 topics and ≥2 dates.`),
    gateWithInsufficient(2, "Inter-reviewer agreement", validKappas.length < 3 || !allResultKappaLabelsPresent,
      validKappas.length === 3 && validKappas.every((value) => value >= 0.70),
      `Cohen's κ: topic ${fmtKappa(kappas.topicMatch)} (n=${kappaDenominators.topicMatch}), market relevance ${fmtKappa(kappas.marketRelevance)} (n=${kappaDenominators.marketRelevance}), geography ${fmtKappa(kappas.geographyOverclaim)} (n=${kappaDenominators.geographyOverclaim}); target ≥0.70 for each, with paired labels for all reviewed results.`),
    gateWithInsufficient(3, "On-topic market relevance precision", acceptedResults.length === 0 || unadjudicatedPrecisionRows > 0 || underSampledProviders.length > 0 || REQUIRED_LENSES.some((lens) => precisionByLens[lens].denominator < 50),
      overallPrecision.rate !== null && overallPrecision.rate >= 0.80 && allPrecisionLensesPass,
      `Overall ${fmtProportion(overallPrecision)}; per-lens floor 70%, overall target 80%. Provider-level rates/denominators are reported separately. ${unadjudicatedPrecisionRows} included item(s) lack a final topic/relevance label. Providers with <20 reviewed accepted items are insufficient, not passing: ${underSampledProviders.join(", ") || "none"}.`),
    gateWithInsufficient(4, "Auditable summary claims", !claims.length || !claimCoverageSufficient || fluentClaims.length !== claims.length || supportedClaims.length !== claims.length || resolvedCitationLabels.length !== claims.length * 2 || exactQuoteLabels.length !== claims.length * 2 || geographyReviewed.length !== claims.length || postAttributionReviewed.length !== claims.length || counterevidenceReviewed.length !== claims.length || claims.some((row) => !["overview", "comparison"].includes(row.claim_type)) || comparisonClaims.some((row) => row.adjudicated_comparison_cites_both_sides === ""),
      claimQualityPass && semanticSupport.rate !== null && semanticSupport.rate >= 0.90 && citationResolution.rate === 1 && exactQuotePresence.rate === 1 && unsupportedGeography.numerator === 0 && postAttributionAccuracy.rate === 1 && (comparisonClaims.length === 0 || comparisonSides.rate === 1) && counterevidenceOmissions.numerator === 0,
      `Summary claim coverage by lens (claims/topics/dates/semantic support): ${REQUIRED_LENSES.map((lens) => `${lens} ${claimCoverageByLens[lens].claims}/${claimCoverageByLens[lens].topics}/${claimCoverageByLens[lens].dates}/${fmtProportion(claimCoverageByLens[lens].semanticSupport)}`).join(", ")}; minimum 10/5/2 per lens and ≥90% support; exact citations/quotes; at least one both-sided comparison per non-English lens. Overall semantic support ${fmtProportion(semanticSupport)}; citation resolution ${fmtProportion(citationResolution)}; exact quote ${fmtProportion(exactQuotePresence)}; post-claim attribution ${fmtProportion(postAttributionAccuracy)}; unsupported geographic claims ${unsupportedGeography.numerator}/${unsupportedGeography.denominator}; comparison-both-sides ${fmtProportion(comparisonSides)}; counterevidence omitted ${counterevidenceOmissions.numerator}/${counterevidenceOmissions.denominator}.`),
    gateWithInsufficient(5, "Duplicate detection", !duplicateItems.length || unreviewedDuplicateLabels > 0 || missingDuplicateGroup > 0 || singletonDuplicateGroups > 0 || duplicateFlagPrecision.denominator === 0,
      duplicateRecall.rate !== null && duplicateRecall.rate >= 0.90 && duplicateFlagPrecision.rate !== null && duplicateFlagPrecision.rate >= 0.90,
      `Duplicate recall ${fmtProportion(duplicateRecall)} across ${uniqueDuplicateGroups.size} reviewer-labeled duplicate group(s); duplicate-flag precision ${fmtProportion(duplicateFlagPrecision)}. Both targets are ≥90%; false-positive collapse must not exceed 10%. ${unreviewedDuplicateLabels} result(s) lack an adjudicated duplicate label; ${missingDuplicateGroup} confirmed duplicates lack a group ID; ${singletonDuplicateGroups} duplicate group(s) contain fewer than two sampled records.`),
    gateWithInsufficient(6, "Distinct community operators", !highVolumeRuns.size || (uncertainVolumeRuns.length > 0 && (operatorBreadth.rate ?? 0) < 0.70),
      operatorBreadth.rate !== null && operatorBreadth.rate >= 0.70,
      `${multiOperatorRuns}/${highVolumeRuns.size} known runs with ≥10 raw discussion records had relevant first-person discussion from ≥2 distinct operators; ${uncertainVolumeRuns.length} additional run(s) have unknown discussion volume. Conservative breadth lower bound ${operatorBreadth.rate === null ? "unmeasured" : `${(operatorBreadth.rate * 100).toFixed(1)}%`} (${operatorBreadth.numerator}/${operatorBreadth.denominator}); target ≥70%. Unknown counts are not zero.`),
    gateWithInsufficient(7, "Provider status accuracy", !statusReviewComplete,
      sourceStatusAccurate,
      `${statusAccuracy.numerator}/${statusAccuracy.denominator} reviewed provider states were adjudicated accurate; every observed unavailable/partial/stale/empty state must be represented correctly.`),
    gateWithInsufficient(8, "Language-label accuracy", REQUIRED_LENSES.some((lens) => languageAccuracyByLens[lens].denominator < 50),
      languageAccuracyPass,
      `Per-lens adjudicated language-label accuracy: ${REQUIRED_LENSES.map((lens) => `${lens} ${fmtProportion(languageAccuracyByLens[lens])}`).join(", ")}. Target ≥90% with at least 50 reviewed records per lens.`),
    gateWithInsufficient(9, "Evidence identity and lineage", !sources.length && !results.length && !claims.length,
      integrity.issues.length === 0,
      integrity.issues.length ? integrity.issues.join("; ") : `All ${integrity.runById.size} search IDs, ${results.length} sampled records, and ${claims.length} summary claims have unique, consistent links to ${integrity.deployedCommits.size} deployed commit(s).`),
    gateWithInsufficient(10, "Overview evidence suitability", !summaryEvidence.length || !summaryEvidenceCoveragePass || unclassifiedResultLabels > 0 || summaryEvidenceByLens["English"].unreviewed > 0 || REQUIRED_LENSES.some((lens) => summaryEvidenceByLens[lens].unreviewed > 0),
      REQUIRED_LENSES.every((lens) => summaryEvidenceByLens[lens].unsuitable === 0) && repeatedSummaryDuplicateGroups === 0,
      `Overview-included evidence by lens (items/topics/dates/unsuitable): ${REQUIRED_LENSES.map((lens) => `${lens} ${summaryEvidenceByLens[lens].count}/${summaryEvidenceByLens[lens].topics}/${summaryEvidenceByLens[lens].dates}/${summaryEvidenceByLens[lens].unsuitable}`).join(", ")}; minimum 10/5/2 per lens. ${unclassifiedResultLabels} result(s) lack required final opinion/spam/language/link/overview-inclusion labels; ${repeatedSummaryDuplicateGroups} duplicate group(s) contribute multiple overview inputs.`),
    gateWithInsufficient(11, "Sampled original-link accessibility", results.length === 0 || REQUIRED_LENSES.some((lens) => results.filter((row) => row.selected_lens === lens).length < 50 || results.filter((row) => row.selected_lens === lens && !isBinary(row.source_link_accessible)).length > 0),
      sourceAccessPrecision.rate !== null && sourceAccessPrecision.rate >= 0.95,
      `Original source links accessible: ${fmtProportion(sourceAccessPrecision)}; target ≥95% overall, with at least 50 reviewed links per lens and no missing access labels.`),
  ];

  return {
    evaluatedAt: new Date().toISOString(),
    evidenceCounts: { uniqueSearches: runIds.size, topics: uniqueTopics.size, resultReviews: results.length, acceptedResultReviews: acceptedResults.length, summaryClaims: claims.length, sourceProviderRows: sources.length },
    lensCoverage,
    precision: { overall: overallPrecision, byLens: precisionByLens, byProvider: precisionByProvider },
    interReviewerKappa: kappas,
    interReviewerKappaDenominators: kappaDenominators,
    summary: { semanticSupport, citationResolution, exactQuotePresence, postAttributionAccuracy, unsupportedGeography, comparisonSides, counterevidenceOmissions, duplicateRecall, duplicateFlagPrecision, operatorBreadth, knownHighVolumeRuns: highVolumeRuns.size, uncertainDiscussionVolumeRuns: uncertainVolumeRuns.length, statusAccuracy, sourceLinkAccessibility },
    languageAccuracyByLens,
    claimCoverageByLens,
    reviewerFluency: { resultRows: results.length, reviewedByAtLeastOneFluentReviewer: fluentResults.length, claimRows: claims.length, reviewedClaimsWithAtLeastOneFluentReviewer: fluentClaims.length },
    evidenceIntegrity: { issueCount: integrity.issues.length, issues: integrity.issues },
    summaryEvidenceByLens,
    gates,
    scoreEligible: gates.every(({ status }) => status === "pass"),
  };
}

type RunIdentity = Pick<AcceptanceSourceRow, "selected_lens" | "topic_label" | "run_date_utc" | "deployed_commit" | "baseline_query" | "local_query">;

function inspectEvidenceIntegrity(sources: AcceptanceSourceRow[], results: AcceptanceResultRow[], claims: AcceptanceClaimRow[]) {
  const issues: string[] = [];
  const runById = new Map<string, RunIdentity>();
  const sourceKeys = new Set<string>();
  const sourceOperators = new Map<string, string>();
  const sourceStatuses = new Map<string, string>();
  const resultKeys = new Set<string>();
  const claimKeys = new Set<string>();
  const deployedCommits = new Set<string>();
  let duplicateSourceRows = 0;
  let conflictingRuns = 0;
  let orphanResults = 0;
  let duplicateResultRows = 0;
  let mismatchedResults = 0;
  let mismatchedResultOperators = 0;
  let resultsFromUnmeasuredSources = 0;
  let orphanClaims = 0;
  let duplicateClaimRows = 0;
  let mismatchedClaims = 0;
  let invalidSourceRows = 0;
  let invalidResultIdentities = 0;
  let invalidClaimIdentities = 0;

  for (const row of sources) {
    const runId = row.run_id.trim();
    const provider = row.provider_key.trim();
    const rawDate = row.run_date_utc.trim();
    const signature: RunIdentity = {
      selected_lens: row.selected_lens.trim(), topic_label: row.topic_label.trim(),
      run_date_utc: rawDate.slice(0, 10), deployed_commit: row.deployed_commit.trim(),
      baseline_query: row.baseline_query.trim(), local_query: row.local_query.trim(),
    };
    const parsedDate = Date.parse(rawDate);
    const status = row.provider_status.trim();
    const counts = [row.raw_returned_count, row.accepted_count, row.excluded_count];
    const validCounts = ["complete", "partial"].includes(status)
      ? counts.every(isMeasuredCount)
      : ["unavailable", "not-searched"].includes(status) && counts.every((value) => value.trim() === "");
    if (!runId || !provider || !row.source_operator_key.trim() || !signature.topic_label ||
      !signature.baseline_query || !signature.local_query || !signature.deployed_commit || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(rawDate) || !Number.isFinite(parsedDate) ||
      !REQUIRED_LENSES.includes(signature.selected_lens as typeof REQUIRED_LENSES[number]) || !validCounts || !isBinary(row.is_community_discussion)) invalidSourceRows++;
    if (signature.deployed_commit) deployedCommits.add(signature.deployed_commit);
    const key = `${runId}\u0000${provider}`;
    if (sourceKeys.has(key)) duplicateSourceRows++;
    sourceKeys.add(key);
    sourceOperators.set(key, row.source_operator_key.trim());
    sourceStatuses.set(key, status);
    const previous = runById.get(runId);
    if (previous && Object.keys(previous).some((field) => previous[field as keyof RunIdentity] !== signature[field as keyof RunIdentity])) conflictingRuns++;
    else if (!previous && runId) runById.set(runId, signature);
  }

  for (const row of results) {
    const runId = row.run_id.trim();
    const provider = row.provider_key.trim();
    const resultId = row.result_id.trim();
    if (!runId || !provider || !resultId) invalidResultIdentities++;
    const key = `${runId}\u0000${provider}\u0000${resultId}`;
    if (resultKeys.has(key)) duplicateResultRows++;
    resultKeys.add(key);
    const identity = runById.get(runId);
    if (!identity || !sourceKeys.has(`${runId}\u0000${provider}`)) orphanResults++;
    else {
      if (["unavailable", "not-searched"].includes(sourceStatuses.get(`${runId}\u0000${provider}`) ?? "")) resultsFromUnmeasuredSources++;
      if (identity.selected_lens !== row.selected_lens.trim() || identity.topic_label !== row.topic_label.trim()) mismatchedResults++;
      if (sourceOperators.get(`${runId}\u0000${provider}`) !== row.source_operator_key.trim()) mismatchedResultOperators++;
    }
  }

  for (const row of claims) {
    const runId = row.run_id.trim();
    const claimId = row.claim_id.trim();
    if (!runId || !claimId) invalidClaimIdentities++;
    const key = `${runId}\u0000${claimId}`;
    if (claimKeys.has(key)) duplicateClaimRows++;
    claimKeys.add(key);
    const identity = runById.get(runId);
    if (!identity) orphanClaims++;
    else if (identity.selected_lens !== row.selected_lens.trim()) mismatchedClaims++;
  }

  if (duplicateSourceRows) issues.push(`${duplicateSourceRows} duplicate provider/search source row(s)`);
  if (conflictingRuns) issues.push(`${conflictingRuns} search ID(s) map to conflicting topic/lens/date/query/commit metadata`);
  if (duplicateResultRows) issues.push(`${duplicateResultRows} duplicate sampled result identity row(s)`);
  if (orphanResults) issues.push(`${orphanResults} sampled result row(s) do not link to a recorded provider/search`);
  if (mismatchedResults) issues.push(`${mismatchedResults} sampled result row(s) disagree with their search topic or lens`);
  if (mismatchedResultOperators) issues.push(`${mismatchedResultOperators} sampled result row(s) disagree with the source operator recorded for their provider`);
  if (resultsFromUnmeasuredSources) issues.push(`${resultsFromUnmeasuredSources} sampled result row(s) refer to unavailable or unsearched providers`);
  if (duplicateClaimRows) issues.push(`${duplicateClaimRows} duplicate summary claim ID row(s)`);
  if (orphanClaims) issues.push(`${orphanClaims} summary claim row(s) do not link to a recorded search`);
  if (mismatchedClaims) issues.push(`${mismatchedClaims} summary claim row(s) disagree with their search lens`);
  if (invalidSourceRows) issues.push(`${invalidSourceRows} source/search row(s) have missing or malformed identity, query, status, timestamp, count, or classification fields`);
  if (invalidResultIdentities) issues.push(`${invalidResultIdentities} sampled result row(s) have a missing search, provider, or result ID`);
  if (invalidClaimIdentities) issues.push(`${invalidClaimIdentities} summary claim row(s) have a missing search or claim ID`);
  if (sources.length && deployedCommits.size !== 1) issues.push(`source/search rows span ${deployedCommits.size} deployed commits; exactly one is required`);
  return { issues, runById, deployedCommits };
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function isBinary(value: string): value is "yes" | "no" { return value === "yes" || value === "no"; }

function cohenKappa(rows: AcceptanceResultRow[], left: keyof AcceptanceResultRow, right: keyof AcceptanceResultRow): number | null {
  const pairs = rows.map((row) => [row[left], row[right]] as const).filter(([a, b]) => isBinary(a) && isBinary(b));
  if (!pairs.length) return null;
  const agree = pairs.filter(([a, b]) => a === b).length / pairs.length;
  const yesA = pairs.filter(([a]) => a === "yes").length / pairs.length;
  const yesB = pairs.filter(([, b]) => b === "yes").length / pairs.length;
  const noA = 1 - yesA;
  const noB = 1 - yesB;
  const expected = yesA * yesB + noA * noB;
  return expected === 1 ? null : (agree - expected) / (1 - expected);
}

function pairedBinaryLabelCount(rows: AcceptanceResultRow[], left: keyof AcceptanceResultRow, right: keyof AcceptanceResultRow): number {
  return rows.filter((row) => isBinary(row[left]) && isBinary(row[right])).length;
}

function proportion(numerator: number, denominator: number): Proportion {
  if (!denominator) return { numerator, denominator, rate: null, confidence95: null };
  const rate = numerator / denominator;
  const z = 1.959963984540054;
  const z2 = z * z;
  const divisor = 1 + z2 / denominator;
  const center = (rate + z2 / (2 * denominator)) / divisor;
  const half = z * Math.sqrt(rate * (1 - rate) / denominator + z2 / (4 * denominator * denominator)) / divisor;
  return { numerator, denominator, rate, confidence95: [Math.max(0, center - half), Math.min(1, center + half)] };
}

function nonNegativeInt(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isMeasuredCount(value: string): boolean {
  return /^\d+$/u.test(value.trim()) && Number.isSafeInteger(Number(value));
}

function gateWithInsufficient(id: number, name: string, insufficient: boolean, passed: boolean, detail: string): AcceptanceGate {
  return { id, name, status: insufficient ? "insufficient" : passed ? "pass" : "fail", detail };
}

function fmtKappa(value: number | null) { return value === null ? "insufficient" : value.toFixed(3); }

function fmtProportion(value: Proportion) {
  if (value.rate === null || !value.confidence95) return `insufficient (${value.numerator}/${value.denominator})`;
  return `${(value.rate * 100).toFixed(1)}% (${value.numerator}/${value.denominator}; 95% CI ${(value.confidence95[0] * 100).toFixed(1)}–${(value.confidence95[1] * 100).toFixed(1)}%)`;
}
