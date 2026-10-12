import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceResults, SummaryPassageText, visibleSummaryEvidence } from "./research-sweep";
import { includesExternalLink } from "../../lib/research-sweep";
import { citationKey } from "../../lib/perspective-snapshot";

describe("summary evidence links", () => {
  it("renders distinct observations with separate source links and quote disclosures", () => {
    const html = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "Combined text must not replace the observations.", citations: ["C1", "C2"], claims: [
        { text: "One post reports rising demand.", citations: ["C1"], supportingQuotes: [{ citationId: "C1", quote: "demand is rising" }] },
        { text: "Another post reports falling demand.", citations: ["C2"], supportingQuotes: [{ citationId: "C2", quote: "demand is falling" }] },
      ] }, citedBreadth: { excerptCount: 2, platformLabels: ["Bluesky", "Lemmy"] },
    }));
    expect(html).not.toContain("Combined text must not replace");
    expect(html).toContain('One post reports rising demand.</p><details class="summary-citation-disclosure"');
    expect(html).toContain('Another post reports falling demand.</p><details class="summary-citation-disclosure"');
    expect(html.match(/Sources for this point/g)).toHaveLength(2);
    expect(html.match(/Cited basis:/g)).toHaveLength(1);
    expect(html.match(/Event timing is unverified:/g)).toHaveLength(1);
    expect(html).toContain('href="#citation-C1"');
    expect(html).toContain('href="#citation-C2"');
  });
  it.each(["2026", "2026-02", "2026-02-28"])("renders provider calendar precision without invented date/time: %s", (value) => {
    const html = renderToStaticMarkup(createElement(SourceResults, {
      result: { key: "crossref", label: "Crossref", query: "inflation", asOf: "2026-10-12T00:00:00Z", window: "Five-year earliest-date screen", evidence: [], error: null, status: "complete" },
      evidence: [{ id: "date", title: "Inflation", url: "https://doi.org/10.1234/date", source: "Crossref", evidenceClass: "research literature", language: "Not reported", timeLabel: "Published · provider date precision", timeValue: value, context: "Missing date parts are unknown." }],
      returnedCount: 1, duplicateCount: 0, summaryCandidateCount: 0, citationIds: new Map(), summaryCitationIds: new Set<string>(),
    }));
    expect(html).toContain(`<time dateTime="${value}">${value}</time>`);
    expect(html).not.toContain("00:00:00");
  });
  it("distinguishes a one-platform cited basis from broader selected inputs", () => {
    const html = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "One retrieved post reports weaker demand.", citations: ["C1"] },
      citedBreadth: { excerptCount: 1, platformLabels: ["Bluesky"] },
    }));
    expect(html).toContain("Cited basis: 1 unique record · 1 platform: Bluesky");
    expect(html).toContain("This AI overview cites one platform only");
    expect(html).toContain("does not establish agreement or independence");
  });

  it("does not label uncited caveats or deterministic source lists as AI-supported claims", () => {
    const caveat = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "No comparison is available.", citations: [] },
      citedBreadth: { excerptCount: 0, platformLabels: [] },
    }));
    const fallback = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "Inspect the records below.", citations: ["C1"] },
    }));
    expect(caveat).not.toContain("Cited basis");
    expect(fallback).not.toContain("Cited basis");
    expect(fallback).not.toContain("Event timing is unverified:");
  });

  it("does not call a two-platform cited sample independent corroboration", () => {
    const html = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "The cited posts describe different supply conditions.", citations: ["C1", "C2"] },
      citedBreadth: { excerptCount: 2, platformLabels: ["Bluesky", "Lemmy"] },
    }));
    expect(html).toContain("2 unique records · 2 platforms: Bluesky, Lemmy");
    expect(html).not.toContain("cites one platform only");
    expect(html).toContain("does not establish agreement or independence");
  });

  it("shows provider-return and overview-candidate counts separately", () => {
    const html = renderToStaticMarkup(createElement(SourceResults, {
      result: {
        key: "bluesky:0", label: "Bluesky", query: "solar", asOf: "2026-10-10T00:00:00.000Z",
        retrievedAt: "2026-10-10T00:00:01.000Z", window: "Last seven days", evidence: [], error: null, status: "complete",
      },
      evidence: [],
      returnedCount: 9,
      duplicateCount: 0,
      summaryCandidateCount: 2,
      citationIds: new Map(),
      summaryCitationIds: new Set<string>(),
    }));

    expect(html).toContain("0 topic matches · 9 returned");
    expect(html).toContain("2 unique excerpts pass overview filters before platform/account balancing and the eight-item cap.");
    expect(html).not.toContain("record also appeared");
    expect(html).toContain("none are displayable in this view");
  });

  it("distinguishes source-safety exclusions from duplicates and genuine empty searches", () => {
    const html = renderToStaticMarkup(createElement(SourceResults, {
      result: {
        key: "lemmy:lemmy.world", label: "Lemmy", query: "solar", asOf: "2026-10-10T00:00:00.000Z",
        window: "Seven days", evidence: [], error: null, status: "complete", providerReturnedCount: 3, adapterExcludedCount: 3,
      },
      evidence: [], returnedCount: 3, duplicateCount: 0, summaryCandidateCount: 0,
      citationIds: new Map(), summaryCitationIds: new Set<string>(),
    }));
    expect(html).toContain("3 source-safety exclusions");
    expect(html).toContain("failed freshness, moderation, bot, or record-safety checks");
    expect(html).not.toContain("also appeared");
    expect(html).not.toContain("no matching records returned");
  });

  it("labels official market statistics as context excluded from community overviews", () => {
    const html = renderToStaticMarkup(createElement(SourceResults, {
      result: {
        key: "eia-energy-prices", label: "EIA · U.S. energy benchmark prices", query: "crude oil", asOf: "2026-10-10T00:00:00.000Z",
        retrievedAt: "2026-10-10T00:00:01.000Z", window: "WTI / Brent · five daily observations", evidence: [], error: null, status: "complete",
      },
      evidence: [{
        id: "eia:RWTC:2026-10-09", title: "WTI · USD 72.20 · 2026-10-09", url: "https://www.eia.gov/opendata/browser/petroleum/pri/spt?series=RWTC",
        source: "EIA", evidenceClass: "official statistical data", language: "Not applicable", timeLabel: "Observation date", timeValue: "2026-10-09T00:00:00.000Z",
        context: "U.S. benchmark only; not the selected country's price or public opinion.", attribution: "EIA · public-domain data",
      }],
      returnedCount: 1,
      duplicateCount: 0,
      summaryCandidateCount: 0,
      citationIds: new Map([[citationKey("eia-energy-prices", "eia:RWTC:2026-10-09"), "C1"]]),
      summaryCitationIds: new Set<string>(),
    }));

    expect(html).toContain("Official statistical context · excluded from community overviews");
    expect(html).toContain("U.S. benchmark only; not the selected country&#x27;s price or public opinion.");
    expect(html).toContain("EIA · public-domain data");
  });

  it("preserves month-only precision for BIS observations instead of inventing a first-of-month date", () => {
    const html = renderToStaticMarkup(createElement(SourceResults, {
      result: {
        key: "bis-effective-exchange", label: "BIS · official effective-exchange-rate context", query: "USD currency", asOf: "2026-10-12T00:00:00.000Z",
        retrievedAt: "2026-10-12T00:00:01.000Z", window: "Monthly index observations", evidence: [], error: null, status: "complete",
      },
      evidence: [{
        id: "bis-eer:KR:N:2026-08", title: "South Korea · nominal effective exchange rate (broad basket)", url: "https://data.bis.org/topics/EER/BIS%2CWS_EER%2C1.0/M.N.B.KR",
        source: "Bank for International Settlements (BIS)", evidenceClass: "official statistical data", language: "Not applicable", timeLabel: "Latest monthly observation", timeValue: "2026-08",
        context: "Index 89.15 (2020 = 100).",
      }],
      returnedCount: 1,
      duplicateCount: 0,
      summaryCandidateCount: 0,
      citationIds: new Map([[citationKey("bis-effective-exchange", "bis-eer:KR:N:2026-08"), "C1"]]),
      summaryCitationIds: new Set<string>(),
    }));

    expect(html).toContain("<time dateTime=\"2026-08\">2026-08</time>");
    expect(html).not.toContain("2026-08-01T00:00:00.000Z");
    expect(html).toContain("Official statistical context · excluded from community overviews");
  });

  it("recognizes bare external domains in social text as link-sharing provenance", () => {
    expect(includesExternalLink("Publisher source: news.ikbc.co.kr/article/story")).toBe(true);
    expect(includesExternalLink("More on the topic at BigEarthData.ai")).toBe(true);
    expect(includesExternalLink("https://stockhandbook.blog/2026/10/05/story")).toBe(true);
    expect(includesExternalLink("Read the full report at markets.example.shop/semiconductors")).toBe(true);
    expect(includesExternalLink("Semiconductor demand is changing across markets.")).toBe(false);
  });

  it("links each passage's validated citations to the consolidated source register", () => {
    const html = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "The retrieved posts discuss supply conditions.", citations: ["C1", "C4"] },
    }));

    expect(html).toContain("Sources for this point · 2");
    expect(html).toContain('href="#citation-C1"');
    expect(html).toContain('href="#citation-C4"');
  });

  it("shows server-validated verbatim excerpts behind an optional disclosure", () => {
    const html = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: {
        text: "One cited post describes uncertain demand.",
        citations: ["C1"],
        supportingQuotes: [{ citationId: "C1", quote: "Demand may remain uncertain this quarter." }],
      },
    }));

    expect(html).toContain("Sources for this point · 1");
    expect(html).toContain('<ul class="summary-quote-list">');
    expect(html).toContain('href="#citation-C1"');
    expect(html).toContain("Demand may remain uncertain this quarter.");
  });

  it("does not add an empty evidence label when a deterministic passage has no citations", () => {
    const html = renderToStaticMarkup(createElement(SummaryPassageText, {
      passage: { text: "No comparison is available.", citations: [] },
    }));

    expect(html).toContain("No comparison is available.");
    expect(html).not.toContain("Evidence:");
  });

  it("keeps a cited source visible when it falls beyond the initial eight-result preview", () => {
    const evidence = Array.from({ length: 10 }, (_, index) => ({
      id: `post-${index + 1}`,
      title: `Post ${index + 1}`,
      url: `https://example.test/${index + 1}`,
      source: "Bluesky",
      evidenceClass: "social discussion" as const,
      language: "English",
      timeLabel: "Published",
      timeValue: "2026-10-10T00:00:00.000Z",
    }));
    const ids = new Map([[citationKey("bluesky", "post-9"), "C9"]]);
    const visible = visibleSummaryEvidence(evidence, false, "bluesky", ids, new Set(["C9"]));

    expect(visible.map(({ id }) => id)).toContain("post-9");
    expect(visible).toHaveLength(9);
    expect(visibleSummaryEvidence(evidence, true, "bluesky", ids, new Set(["C9"]))).toHaveLength(10);
  });
});
