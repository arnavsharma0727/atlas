import { describe, expect, it } from "vitest";
import { selectOverviewEvidence } from "./overview-evidence";
import { buildCitationIds } from "./perspective-snapshot";
import type { ResearchSweepSourceResult } from "./research-sweep";

const localTexts = {
  en: "Solar demand is increasing while inventories fall.",
  de: "Solar Nachfrage steigt bei niedrigem Angebot.",
  fr: "Solar demande augmente avec une baisse des prix.",
  pt: "Solar demanda cresce com preços menores.",
  es: "Solar demanda crece con precios menores.",
  ko: "Solar 시장의 수요가 늘어나고 있다.",
  ja: "Solar 市場の需要が増加している。",
  hi: "Solar बाजार में मांग बढ़ रही है।",
};

function row(key: string, language: string, text: string): ResearchSweepSourceResult {
  return {
    key, label: "Mastodon", query: "Solar", asOf: "2026-10-12T00:00:00Z", window: "30 days",
    error: null, status: "complete", evidence: [{
      id: key, title: "Synthetic test fixture", url: `https://example.test/${encodeURIComponent(key)}`,
      source: "Mastodon", sourceOperatorKey: "mastodon-federation", evidenceClass: "social discussion",
      language, timeLabel: "Published", timeValue: "2026-10-11T00:00:00Z", transientPreview: text,
    }],
  };
}

describe("overview selection uses the current search invocation", () => {
  it("keeps German and unlabelled posts in citations but out of the English baseline overview", () => {
    const english = row("bluesky:en", "en", "Inflation is slowing as consumer prices stabilize.");
    const german = row("mastodon:de", "de", "Inflation sinkt, doch die Preise steigen weiter.");
    const unlabelled = row("lemmy:und", "und", "Inflation happens while I try to save money.");
    const rows = [english, german, unlabelled];
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), { topic: "inflation", localTopic: "inflation", selectedLanguage: "en" });
    expect(selected.evidence.us.map(({ excerpt }) => excerpt)).toEqual([english.evidence[0].transientPreview]);
    expect(selected.candidateCounts).toEqual({ "bluesky:en": 1 });
  });
  it("retains original purchase-price commentary without admitting links or dropping topic checks", () => {
    const independent = row("bluesky:1", "en", "GPU prices have stopped me from upgrading my desktop.");
    const linked = row("bluesky:2", "en", "GPU prices are rising; read this article.");
    linked.evidence[0].linkSharing = true;
    const unrelated = row("bluesky:3", "en", "Coffee prices have stopped me from buying drinks.");
    const rows = [independent, linked, unrelated];
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), { topic: "GPU", localTopic: "GPU", selectedLanguage: "en" });
    expect(selected.evidence.us.map(({ excerpt }) => excerpt)).toEqual([independent.evidence[0].transientPreview]);
    expect(selected.excludedCounts.baseline).toBe(2);
  });
  it.each([
    ["en", "inflation", "Inflation is slowing."],
    ["fr", "chômage", "Le chômage augmente."],
    ["de", "Rezession", "Die Rezession hält an."],
  ])("retains macroeconomic commentary for the %s overview with its exact topic", (language, localTopic, excerpt) => {
    const rows = [row(`local:mastodon:${language}`, language, excerpt)];
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), {
      topic: "macroeconomy", localTopic, selectedLanguage: language,
    });
    expect(selected.evidence.local.map((item) => item.excerpt)).toEqual([excerpt]);
    expect(selected.excludedCounts.selected).toBe(0);
  });

  it("does not drop a French market excerpt merely because marché ends in an accented letter", () => {
    const rows = [row("local:mastodon:fr", "fr", "Le marché du cuivre ralentit.")];
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), {
      topic: "copper", localTopic: "cuivre", selectedLanguage: "fr",
    });
    expect(selected.evidence.local.map(({ excerpt }) => excerpt)).toEqual(["Le marché du cuivre ralentit."]);
    expect(selected.excludedCounts.selected).toBe(0);
  });

  it("switches across every configured language without inheriting the previous lens", () => {
    const rows = [row("bluesky", "en", "Solar supply is constrained by factory capacity."),
      ...Object.entries(localTexts).map(([language, text]) => row(`local:mastodon:${language}`, language, text))];
    const citations = buildCitationIds(rows);
    for (const selectedLanguage of ["ko", "de", "fr", "ja", "es", "hi", "pt", "en", "ko"]) {
      const selected = selectOverviewEvidence(rows, citations, { topic: "Solar", localTopic: "Solar", selectedLanguage });
      expect(selected.evidence.us).toHaveLength(1);
      expect(selected.evidence.local).toHaveLength(1);
      expect(selected.evidence.local[0].language).toBe(selectedLanguage);
      expect(selected.evidence.local[0].excerpt).toBe(localTexts[selectedLanguage as keyof typeof localTexts]);
      expect(selected.candidateCounts[`local:mastodon:${selectedLanguage}`]).toBe(1);
    }
  });

  it("keeps each side's topic, independent-opinion gate, and rejection counts separate", () => {
    const rows = [
      row("bluesky", "en", "Solar market demand is rising."),
      row("local:mastodon:good", "de", "Erdgas Nachfrage steigt."),
      row("local:mastodon:wrong-topic", "de", "Solar Nachfrage steigt."),
      row("local:mastodon:linked", "de", "Erdgas Nachfrage steigt https://example.test/news"),
    ];
    rows[3].evidence[0].linkSharing = true;
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), { topic: "Solar", localTopic: "Erdgas", selectedLanguage: "de" });
    expect(selected.evidence.us).toHaveLength(1);
    expect(selected.evidence.local.map(({ excerpt }) => excerpt)).toEqual(["Erdgas Nachfrage steigt."]);
    expect(selected.excludedCounts).toEqual({ baseline: 0, selected: 2 });
    expect(selected.candidateCounts).toEqual({ bluesky: 1, "local:mastodon:good": 1 });
  });

  it("does not turn reporting or official context into a discussion overview", () => {
    const rows = ["global-voices", "local:global-voices", "world-bank-macro", "eia-energy-prices", "bis-effective-exchange", "the-conversation:uk", "local:the-conversation:fr"]
      .map((key) => row(key, "en", "Solar market demand is rising."));
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), { topic: "Solar", localTopic: "Solar", selectedLanguage: "en" });
    expect(selected.evidence).toEqual({ us: [], local: [] });
    expect(selected.candidateCounts).toEqual({});
  });

  it("does not count the same original as evidence on both sides", () => {
    const baseline = row("mastodon", "en", "Solar market demand is rising.");
    const copy = { ...baseline, key: "local:mastodon" };
    const rows = [baseline, copy];
    const selected = selectOverviewEvidence(rows, buildCitationIds(rows), { topic: "Solar", localTopic: "Solar", selectedLanguage: "en" });
    expect(selected.evidence.us).toHaveLength(1);
    expect(selected.evidence.local).toEqual([]);
  });
});
