export type ResearchEvidenceClass = "expert Q&A" | "social discussion" | "news coverage" | "editorial discussion" | "expert analysis" | "research literature" | "community forum" | "official company disclosure" | "official statistical data" | "official policy release" | "survey research" | "crowd forecast";

export type ResearchEvidence = {
  id: string;
  title: string;
  url: string;
  source: string;
  evidenceClass: ResearchEvidenceClass;
  language: string;
  timeLabel: string;
  timeValue: string;
  context?: string;
  /** Supporting retrieval was deferred/failed; preserve this flag through cached source views. */
  retrievalIncomplete?: boolean;
  /** Researcher-authored paraphrase of what this source contributes. */
  researcherNote?: string;
  /** Researcher attestation that the original citation was opened and checked. */
  researcherVerifiedOriginal?: boolean;
  attribution?: string;
  attributionUrl?: string;
  licenseName?: string;
  licenseUrl?: string;
  researcherAssessment?: "supports" | "contradicts" | "context" | "not relevant";
  /** Assigned only by reviewed source constructors; never infer independence from labels. */
  sourceOperatorKey?: string;
  sourceOperatorLabel?: string;
  /** Ephemeral source preview for in-browser review; strip before adding a citation to a brief. */
  transientPreview?: string;
  /** Licensed expert-answer excerpts are displayed for review but not transmitted to AI. */
  summaryEligible?: boolean;
  /** True when the public post includes an external URL; linked content may not be the author's own view. */
  linkSharing?: boolean;
};

/** Canonical identity for detecting repeated selected links, never publisher ownership. */
export function canonicalEvidenceSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hostname = url.hostname.toLocaleLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function citationWithoutTransientContent(item: ResearchEvidence): ResearchEvidence {
  const citation = { ...item };
  delete citation.transientPreview;
  return citation;
}

export type ResearchBriefDraft = {
  topic: string;
  workingThesis: string;
  alternatives: string;
  disconfirmingEvidence: string;
  evidence: ResearchEvidence[];
  exportedAt: string;
};

export type ResearchLeadReadiness = {
  readyForHumanReview: boolean;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
  reviewedOperators: string[];
};

/** A strict local checklist for a researcher-authored dossier, never an automated finding. */
export function assessResearchLeadReadiness(input: {
  topic: string;
  workingThesis: string;
  alternatives: string;
  disconfirmingEvidence: string;
  evidence: ResearchEvidence[];
  asOf?: number;
}): ResearchLeadReadiness {
  const now = input.asOf ?? Date.now();
  const recentEvidence = input.evidence.filter((item) => {
    const published = Date.parse(item.timeValue);
    return Number.isFinite(published) && published <= now && now - published <= 30 * 86400000;
  });
  const relevanceReviewed = recentEvidence.every((item) => item.researcherAssessment !== undefined);
  const relevantEvidence = recentEvidence.filter((item) =>
    item.researcherAssessment !== undefined && item.researcherAssessment !== "not relevant");
  const uniqueRelevantByUrl = new Map<string, ResearchEvidence>();
  let invalidRelevantUrlCount = 0;
  for (const item of relevantEvidence) {
    const identity = canonicalEvidenceSourceUrl(item.url);
    if (!identity) {
      invalidRelevantUrlCount++;
      continue;
    }
    if (!uniqueRelevantByUrl.has(identity)) uniqueRelevantByUrl.set(identity, item);
  }
  const uniqueRelevantEvidence = [...uniqueRelevantByUrl.values()];
  const duplicateRelevantUrlCount = relevantEvidence.length - invalidRelevantUrlCount - uniqueRelevantEvidence.length;
  const documentedRelevantEvidence = uniqueRelevantEvidence.filter((item) =>
    typeof item.researcherNote === "string" && item.researcherNote.trim().length >= 20);
  const checkedRelevantEvidence = uniqueRelevantEvidence.filter((item) => item.researcherVerifiedOriginal === true);
  const bylines = summarizeConversationBylines(uniqueRelevantEvidence);
  const largestBylineShare = bylines.attributedItemCount
    ? bylines.largestBylineGroup / bylines.attributedItemCount
    : 1;
  const operatorLabels = new Map<string, Set<string>>();
  for (const item of uniqueRelevantEvidence) {
    if (!item.sourceOperatorKey || !item.sourceOperatorLabel) continue;
    const labels = operatorLabels.get(item.sourceOperatorKey) ?? new Set<string>();
    labels.add(item.sourceOperatorLabel);
    operatorLabels.set(item.sourceOperatorKey, labels);
  }
  const operators = [...operatorLabels.keys()].sort();
  const operatorDisplay = [...operatorLabels.values()].flatMap((labels) => [...labels]).sort();
  const classes = new Set(uniqueRelevantEvidence.map((item) => item.evidenceClass));
  const assessments = new Set(uniqueRelevantEvidence.map((item) => item.researcherAssessment));
  const checks = [
    { label: "Specific topic and working thesis", passed: input.topic.trim().length >= 3 && input.workingThesis.trim().length >= 20, detail: "Write a specific question (at least 3 characters) and a testable tentative explanation (at least 20 characters)." },
    { label: "Relevance reviewed for every recent citation", passed: relevanceReviewed, detail: `${recentEvidence.filter((item) => !item.researcherAssessment).length} recent citations remain unassessed; mark unrelated items “Not relevant.”` },
    { label: "Relevant citations use valid HTTPS source links", passed: invalidRelevantUrlCount === 0, detail: `${invalidRelevantUrlCount} relevant citation(s) have an invalid or non-HTTPS source URL.` },
    { label: "At least three unique recent, relevant citations", passed: uniqueRelevantEvidence.length >= 3, detail: `${uniqueRelevantEvidence.length} unique source link(s) are marked relevant; ${duplicateRelevantUrlCount} duplicate link(s) are counted only once and “Not relevant” items are excluded.` },
    { label: "Original sources checked", passed: uniqueRelevantEvidence.length > 0 && checkedRelevantEvidence.length === uniqueRelevantEvidence.length, detail: `${checkedRelevantEvidence.length}/${uniqueRelevantEvidence.length} unique relevant source link(s) are attested as opened and checked against the original.` },
    { label: "Source-specific evidence documented", passed: uniqueRelevantEvidence.length > 0 && documentedRelevantEvidence.length === uniqueRelevantEvidence.length, detail: `${documentedRelevantEvidence.length}/${uniqueRelevantEvidence.length} unique relevant source link(s) have a source-specific paraphrase of at least 20 characters.` },
    { label: "At least two reviewed source operators", passed: operators.length >= 2, detail: operators.length ? `${operators.length} reviewed operator(s): ${operatorDisplay.join(" · ")}` : "No reviewed source operator is represented yet." },
    { label: "Discussion plus reporting or expert analysis", passed: (classes.has("social discussion") || classes.has("community forum")) && (classes.has("news coverage") || classes.has("expert analysis")), detail: "Requires at least one community/social citation and one news or expert-analysis citation." },
    { label: "Multiple conversation bylines; no single label over 60%", passed: bylines.itemCount >= 2 && bylines.attributedItemCount === bylines.itemCount && bylines.distinctBylineLabels >= 2 && largestBylineShare <= 0.6, detail: `${bylines.distinctBylineLabels} distinct byline label(s) across ${bylines.attributedItemCount}/${bylines.itemCount} attributed conversation citation(s); largest label is ${Math.round(largestBylineShare * 100)}% of attributed items. Labels do not verify separate people.` },
    { label: "Supporting and contradicting evidence reviewed", passed: assessments.has("supports") && assessments.has("contradicts"), detail: "Mark at least one citation as supporting and another as contradicting the thesis." },
    { label: "Alternative explanation and disconfirmation test", passed: input.alternatives.trim().length >= 20 && input.disconfirmingEvidence.trim().length >= 20, detail: "Record another plausible explanation and a disconfirmation test (at least 20 characters each)." },
  ];
  return { readyForHumanReview: checks.every((check) => check.passed), checks, reviewedOperators: operatorDisplay };
}

export type EvidenceCoverage = {
  itemCount: number;
  conversationItemCount: number;
  conversationItemsWithByline: number;
  distinctConversationBylineLabels: number;
  largestConversationBylineGroup: number;
  sourceLabels: string[];
  languages: string[];
  researcherAssessments: { assessment: NonNullable<ResearchEvidence["researcherAssessment"]>; count: number }[];
  unassessedCount: number;
  evidenceClasses: { evidenceClass: ResearchEvidenceClass; count: number }[];
  earliest: string | null;
  latest: string | null;
  knownOperatorLabels: string[];
  unresolvedOperatorItemCount: number;
};

export type ConversationBylineCoverage = {
  itemCount: number;
  attributedItemCount: number;
  distinctBylineLabels: number;
  largestBylineGroup: number;
};

/**
 * Descriptive audit of displayed author/byline labels in one selected sample.
 * It does not verify that a label is a person, or that two labels are distinct
 * people. Unknown labels are left uncounted rather than guessed.
 */
export function summarizeConversationBylines(evidence: ResearchEvidence[]): ConversationBylineCoverage {
  const conversation = evidence.filter(({ evidenceClass }) =>
    evidenceClass === "expert Q&A" || evidenceClass === "social discussion" || evidenceClass === "community forum");
  const counts = new Map<string, number>();
  let attributedItemCount = 0;
  for (const item of conversation) {
    const explicitLabel = item.attribution?.match(/^(?:Lemmy )?Author:\s*(.+)$/i)?.[1];
    const rawLabel = explicitLabel ?? (item.evidenceClass === "community forum" ? item.attribution : undefined);
    const label = rawLabel?.trim().replace(/\s+/g, " ");
    if (!label) continue;
    attributedItemCount += 1;
    const operator = item.sourceOperatorKey ?? item.source;
    const key = `${operator.normalize("NFKC").toLocaleLowerCase()}\u0000${label.normalize("NFKC").toLocaleLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    itemCount: conversation.length,
    attributedItemCount,
    distinctBylineLabels: counts.size,
    largestBylineGroup: Math.max(0, ...counts.values()),
  };
}

export type RepeatedPostTextCoverage = {
  previewItemCount: number;
  repeatedItemCount: number;
  largestRepeatedGroup: number;
};

/** Group exact normalized social-post previews for compact display; never merges citations. */
export function groupRepeatedPostText(evidence: ResearchEvidence[]): ResearchEvidence[][] {
  const groups = new Map<string, ResearchEvidence[]>();
  const ungrouped: ResearchEvidence[][] = [];
  for (const item of evidence) {
    if (item.evidenceClass !== "social discussion" || !item.transientPreview?.trim()) {
      ungrouped.push([item]);
      continue;
    }
    const key = normalizePostPreview(item.transientPreview);
    if (!key) {
      ungrouped.push([item]);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const byFirstEvidenceIndex = new Map<ResearchEvidence, number>();
  evidence.forEach((item, index) => byFirstEvidenceIndex.set(item, index));
  return [...ungrouped, ...[...groups.values()].map((group) => group)]
    .sort((a, b) => byFirstEvidenceIndex.get(a[0])! - byFirstEvidenceIndex.get(b[0])!);
}

/** A cluster of identical transient social text may contribute only one citation. */
export function hasSelectedRepeatedTextMember(
  group: ResearchEvidence[],
  selectedIds: ReadonlySet<string>,
): boolean {
  return group.length > 1 && group.some(({ id }) => selectedIds.has(id));
}

/** Counts exact normalized preview matches without returning or persisting post text. */
export function summarizeRepeatedPostText(evidence: ResearchEvidence[]): RepeatedPostTextCoverage {
  const counts = new Map<string, number>();
  let previewItemCount = 0;
  for (const item of evidence) {
    if (item.evidenceClass !== "social discussion" || !item.transientPreview?.trim()) continue;
    previewItemCount += 1;
    const key = normalizePostPreview(item.transientPreview);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = [...counts.values()].filter((count) => count > 1);
  return {
    previewItemCount,
    repeatedItemCount: repeated.reduce((total, count) => total + count, 0),
    largestRepeatedGroup: Math.max(0, ...repeated),
  };
}

function normalizePostPreview(preview: string): string {
  return preview
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Descriptive inventory only: labels and items are not counts of independent owners. */
export function summarizeEvidenceCoverage(evidence: ResearchEvidence[]): EvidenceCoverage {
  const bylines = summarizeConversationBylines(evidence);
  const timestamps = evidence
    .map(({ timeValue }) => Date.parse(timeValue))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const evidenceClasses: ResearchEvidenceClass[] = [
    "expert Q&A",
    "social discussion",
    "news coverage",
    "editorial discussion",
    "expert analysis",
    "research literature",
    "community forum",
    "official company disclosure",
    "survey research",
    "crowd forecast",
  ];
  const assessments: NonNullable<ResearchEvidence["researcherAssessment"]>[] = [
    "supports",
    "contradicts",
    "context",
    "not relevant",
  ];
  return {
    itemCount: evidence.length,
    conversationItemCount: bylines.itemCount,
    conversationItemsWithByline: bylines.attributedItemCount,
    distinctConversationBylineLabels: bylines.distinctBylineLabels,
    largestConversationBylineGroup: bylines.largestBylineGroup,
    sourceLabels: [...new Set(evidence.map(({ source }) => cleanText(source)).filter(Boolean))].sort(),
    languages: [...new Set(evidence.map(({ language }) => cleanText(language)).filter(Boolean))].sort(),
    researcherAssessments: assessments
      .map((assessment) => ({
        assessment,
        count: evidence.filter((item) => item.researcherAssessment === assessment).length,
      }))
      .filter(({ count }) => count > 0),
    unassessedCount: evidence.filter((item) => !item.researcherAssessment).length,
    evidenceClasses: evidenceClasses
      .map((evidenceClass) => ({
        evidenceClass,
        count: evidence.filter((item) => item.evidenceClass === evidenceClass).length,
      }))
      .filter(({ count }) => count > 0),
    earliest: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
    latest: timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
    knownOperatorLabels: [...new Set(evidence.flatMap(({ sourceOperatorKey, sourceOperatorLabel }) =>
      sourceOperatorKey && sourceOperatorLabel ? [sourceOperatorLabel] : []))].sort(),
    unresolvedOperatorItemCount: evidence.filter(({ sourceOperatorKey, sourceOperatorLabel }) =>
      !sourceOperatorKey || !sourceOperatorLabel).length,
  };
}

/** Read a topic handoff from the URL fragment so it is not sent in the HTTP request path. */
export function topicFromFragment(hash: string): string {
  if (!hash.startsWith("#")) return "";
  return (new URLSearchParams(hash.slice(1)).get("topic") ?? "").trim().slice(0, 100);
}

/** Build a citation-first handoff; never scores evidence or invents a conclusion. */
export function createResearchBriefMarkdown(draft: ResearchBriefDraft): string {
  const coverage = summarizeEvidenceCoverage(draft.evidence);
  const readiness = assessResearchLeadReadiness({
    topic: draft.topic,
    workingThesis: draft.workingThesis,
    alternatives: draft.alternatives,
    disconfirmingEvidence: draft.disconfirmingEvidence,
    evidence: draft.evidence,
    asOf: Date.parse(draft.exportedAt),
  });
  const lines = [
    readiness.readyForHumanReview ? "# Atlas human-reviewed lead dossier" : "# Atlas research brief",
    "",
    `Exported: ${cleanText(draft.exportedAt)}`,
    `Topic: ${cleanText(draft.topic) || "Not specified"}`,
    "",
    readiness.readyForHumanReview
      ? "> The researcher attested to checking each relevant original source and completed the local evidence checklist. This is a human-authored research lead dossier, not an independently verified finding, representative sample, causal conclusion, or investment recommendation. It has not been published to Atlas."
      : "> Exploratory working notes only. Sources are query-selected, incomplete, and not representative by default. This brief is not an investment recommendation or evidence of causality.",
    "",
    "## Working thesis",
    "",
    cleanText(draft.workingThesis) || "Not written.",
    "",
    "## Alternative explanations / counter-evidence",
    "",
    cleanText(draft.alternatives) || "Not written.",
    "",
    "## What would change my mind?",
    "",
    cleanText(draft.disconfirmingEvidence) || "Not written.",
    "",
    "## Selected-sample coverage audit",
    "",
    `- Selected items: ${coverage.itemCount}`,
    `- Discussion/Q&A links: ${coverage.conversationItemCount}; ${coverage.conversationItemsWithByline} with recognized displayed author/byline labels; ${coverage.distinctConversationBylineLabels} distinct labels; largest label group: ${coverage.largestConversationBylineGroup}. Labels are not verified people or proof of independent participation.`,
    `- Source labels: ${coverage.sourceLabels.map(escapeMarkdownLabel).join(", ") || "None"}`,
    `- Reviewed source operators represented: ${coverage.knownOperatorLabels.map(escapeMarkdownLabel).join(", ") || "None"}; unresolved operator items: ${coverage.unresolvedOperatorItemCount}`,
    `- Languages: ${coverage.languages.map(escapeMarkdownLabel).join(", ") || "None"}`,
    `- Evidence classes: ${coverage.evidenceClasses.map(({ evidenceClass, count }) => `${escapeMarkdownLabel(evidenceClass)} (${count})`).join(", ") || "None"}`,
    `- Researcher-assigned assessment: ${coverage.researcherAssessments.map(({ assessment, count }) => `${assessment} (${count})`).join(", ") || "None"}; unassessed: ${coverage.unassessedCount}`,
    `- Publication-time span: ${coverage.earliest && coverage.latest ? `${coverage.earliest} to ${coverage.latest}` : "Unavailable"}`,
    "",
    "> Coverage is descriptive. A source label, language, item, or domain is not necessarily an independent publisher or population sample.",
    "",
    "## Evidence qualification checklist",
    "",
    `- Status: ${readiness.readyForHumanReview ? "Local checklist met; human-reviewed lead dossier prepared (not independently verified or published)" : "Not ready for lead review"}`,
    ...readiness.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.label}: ${check.detail}`),
    "- This checklist does not confirm a lead, source independence beyond reviewed operator labels, or investment implications. “Not relevant” citations do not count toward its evidence checks.",
    "",
    `## Selected evidence (${draft.evidence.length} items)`,
    "",
  ];

  if (!draft.evidence.length) lines.push("No evidence selected.");
  for (const item of draft.evidence) {
    const attribution = [
      item.context ? escapeMarkdownLabel(item.context) : "",
      item.attribution ? escapeMarkdownLabel(item.attribution) : "",
      item.attributionUrl ? `[attribution link](${safeMarkdownUrl(item.attributionUrl)})` : "",
      item.licenseName && item.licenseUrl ? `[${escapeMarkdownLabel(item.licenseName)}](${safeMarkdownUrl(item.licenseUrl)})` : "",
    ].filter(Boolean).join("; ");
    lines.push(
      `- [${escapeMarkdownLabel(item.title) || "Open source item"}](${safeMarkdownUrl(item.url)}) — ${cleanText(item.evidenceClass)}; ${escapeMarkdownLabel(item.source)}; ${escapeMarkdownLabel(item.language)}; ${escapeMarkdownLabel(item.timeLabel)}: ${escapeMarkdownLabel(item.timeValue)}${item.researcherVerifiedOriginal ? "; original checked by researcher" : "; original not attested as checked"}${item.researcherAssessment ? `; researcher assessment: ${item.researcherAssessment}` : ""}${item.researcherNote?.trim() ? `; researcher observation: ${cleanText(item.researcherNote)}` : ""}${attribution ? `; ${attribution}` : ""}`,
    );
  }

  lines.push(
    "",
    "## Coverage note",
    "",
    "These are manually selected links from on-demand provider samples and recent licensed feeds. Source views can overlap; reviewed operator labels are a conservative source audit, not proof of topical independence or a representative population. A low or empty sample does not show that a topic is absent. Check originals, applicable licenses, dates, language, and competing explanations before relying on this brief.",
    "",
  );
  return lines.join("\n");
}

function cleanText(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeMarkdownLabel(value: string) {
  return cleanText(value).replace(/[\\[\]`*_]/g, "\\$&");
}

function safeMarkdownUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().replace(/[()\s]/g, encodeURIComponent) : "#invalid-link";
  } catch {
    return "#invalid-link";
  }
}
