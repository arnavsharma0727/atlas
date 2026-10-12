import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceResults, SummaryPassageText, visibleSummaryEvidence } from "./research-sweep";
import { includesExternalLink } from "../../lib/research-sweep";
import { citationKey } from "../../lib/perspective-snapshot";

describe("summary evidence links", () => {
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

    expect(html).toContain("Evidence:");
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

    expect(html).toContain("Check verbatim source excerpts");
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
