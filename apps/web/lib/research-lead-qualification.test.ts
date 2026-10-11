import { describe, expect, it } from "vitest";
import {
  knownSourceOperator,
  passesIndependentEvidenceGate,
  sourceOperatorsByLead,
  verifiedLeadEvidenceDocumentIds,
} from "./research-lead-qualification";

describe("research lead source-operator gate", () => {
  it("collapses Stack Exchange communities and publisher editions to their shared operators", () => {
    const links = [
      { research_lead_id: "lead", document_id: "1", source_documents: { source_type: "stack-exchange", source_domain: "economics.stackexchange.com", raw_metadata_json: { site: "economics" } } },
      { research_lead_id: "lead", document_id: "2", source_documents: { source_type: "stack-exchange", source_domain: "stackoverflow.com", raw_metadata_json: { site: "es.stackoverflow" } } },
      { research_lead_id: "lead", document_id: "3", source_documents: { source_type: "licensed-reporting", source_domain: "es.globalvoices.org", raw_metadata_json: { publisher: "Global Voices", editionCode: "es" } } },
      { research_lead_id: "lead", document_id: "4", source_documents: { source_type: "licensed-reporting", source_domain: "fr.globalvoices.org", raw_metadata_json: { publisher: "Global Voices", editionCode: "fr" } } },
    ];
    const operators = sourceOperatorsByLead(links);
    expect([...operators.get("lead") ?? []].sort()).toEqual(["global-voices", "stack-exchange"]);
    const verifiedOperators = sourceOperatorsByLead(links, new Map([["lead", new Set(["2", "4"])] ]));
    expect([...verifiedOperators.get("lead") ?? []].sort()).toEqual(["global-voices", "stack-exchange"]);
    expect(sourceOperatorsByLead(links, new Map([["lead", new Set(["1", "2"])] ])).get("lead")).toEqual(new Set(["stack-exchange"]));
    expect(sourceOperatorsByLead(links, new Map()).size).toBe(0);
  });

  it("counts Typst and Stack Exchange as distinct operators only when their reviewed domains and publisher metadata agree", () => {
    expect(knownSourceOperator({ source_type: "licensed-forum", source_domain: "forum.typst.app", raw_metadata_json: { publisher: "Typst Forum" } })).toBe("typst-forum");
    expect(knownSourceOperator({ source_type: "licensed-forum", source_domain: "forum.typst.app", raw_metadata_json: { publisher: "Other forum" } })).toBeNull();
    expect(knownSourceOperator({ source_type: "licensed-forum", source_domain: "discussion.fedoraproject.org", raw_metadata_json: { publisher: "Fedora Discussion", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" } })).toBe("fedora-discussion");
    expect(knownSourceOperator({ source_type: "licensed-forum", source_domain: "discussion.fedoraproject.org", raw_metadata_json: { publisher: "Fedora Discussion", licenseUrl: "https://example.org/" } })).toBeNull();
    expect(knownSourceOperator({ source_type: "licensed-forum", source_domain: "evil.example", raw_metadata_json: { publisher: "Typst Forum" } })).toBeNull();
  });

  it("counts link-only social operators only when the server-recorded citation metadata is intact", () => {
    const metadata = {
      researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
    };
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "bsky.app", raw_metadata_json: { ...metadata, citationProvider: "bluesky" } })).toBe("bluesky");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "mastodon.social", raw_metadata_json: { ...metadata, citationProvider: "mastodon" } })).toBe("mastodon-network");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "piaille.fr", raw_metadata_json: { ...metadata, citationProvider: "mastodon" } })).toBe("mastodon-network");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "unknown.example", raw_metadata_json: { ...metadata, citationProvider: "mastodon" } })).toBeNull();
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "bsky.app", raw_metadata_json: { ...metadata, citationProvider: "bluesky", postBodyDiscarded: false } })).toBeNull();
  });

  it("counts reviewed first-party news and issuer link operators without conflating the two", () => {
    const metadata = {
      researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
      reviewedPublisherKey: "abc-news-australia", reviewedPublisherLabel: "ABC News Australia",
    };
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "www.abc.net.au", raw_metadata_json: { ...metadata, citationProvider: "newslink" } })).toBe("abc-news-australia");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "firmus.co", raw_metadata_json: { ...metadata, citationProvider: "companylink", reviewedPublisherKey: "firmus", reviewedPublisherLabel: "Firmus" } })).toBe("firmus");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "data.verasight.io", raw_metadata_json: { ...metadata, citationProvider: "surveylink", reviewedPublisherKey: "verasight", reviewedPublisherLabel: "Verasight" } })).toBe("verasight");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "www.abc.net.au.attacker.example", raw_metadata_json: { ...metadata, citationProvider: "newslink" } })).toBeNull();
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "www.abc.net.au", raw_metadata_json: { ...metadata, citationProvider: "newslink", reviewedPublisherKey: "fake" } })).toBeNull();
  });

  it("counts researcher-linked Stack Exchange only with reviewed-site and CC BY-SA metadata", () => {
    const metadata = {
      citationProvider: "stackexchange", researcherLinkedOnly: true, postBodyDiscarded: true,
      transientPreviewDiscarded: true, contentLicense: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", titleUnmodified: true, site: "politics",
    };
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "politics.stackexchange.com", raw_metadata_json: metadata })).toBe("stack-exchange");
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "politics.stackexchange.com.evil.example", raw_metadata_json: metadata })).toBeNull();
    expect(knownSourceOperator({ source_type: "researcher-linked-source", source_domain: "politics.stackexchange.com", raw_metadata_json: { ...metadata, contentLicense: "CC BY-NC-SA 4.0" } })).toBeNull();
  });

  it("requires recorded evidence, alternatives, a database count, and two verified operators", () => {
    const lead = {
      independent_source_count: 2,
      verified_evidence_json: [
        { documentId: "doc-a", assessment: "supports", sourceObservation: "The discussion describes a reported local price change." },
        { documentId: "doc-b", assessment: "contradicts", sourceObservation: "The report attributes the change to a different cause." },
        { documentId: "doc-c", assessment: "context", sourceObservation: "The analysis distinguishes retail from wholesale price data." },
      ],
      alternative_explanations_json: [{ explanation: "alternative" }],
    };
    expect(passesIndependentEvidenceGate(lead, new Set(["stack-exchange", "global-voices"]))).toBe(true);
    expect(passesIndependentEvidenceGate(lead, new Set(["stack-exchange"]))).toBe(false);
    expect(passesIndependentEvidenceGate({ ...lead, independent_source_count: 1 }, new Set(["stack-exchange", "global-voices"]))).toBe(false);
    expect(passesIndependentEvidenceGate({ ...lead, alternative_explanations_json: [] }, new Set(["stack-exchange", "global-voices"]))).toBe(false);
    expect(passesIndependentEvidenceGate({ ...lead, verified_evidence_json: {} }, new Set(["stack-exchange", "global-voices"]))).toBe(false);
  });

  it("rejects evidence blobs without three unique linked IDs, source observations, and two-sided review", () => {
    const complete = [
      { documentId: "doc-a", assessment: "supports", sourceObservation: "A sufficiently specific source observation." },
      { documentId: "doc-b", assessment: "contradicts", sourceObservation: "A separate observation that challenges the thesis." },
      { documentId: "doc-c", assessment: "context", sourceObservation: "A third distinct source observation for context." },
    ];
    expect(verifiedLeadEvidenceDocumentIds(complete)).toEqual(new Set(["doc-a", "doc-b", "doc-c"]));
    expect(verifiedLeadEvidenceDocumentIds({ evidence: complete })).toBeNull();
    expect(verifiedLeadEvidenceDocumentIds(complete.slice(0, 2))).toBeNull();
    expect(verifiedLeadEvidenceDocumentIds(complete.map((item) => ({ ...item, documentId: "same" })))).toBeNull();
    expect(verifiedLeadEvidenceDocumentIds(complete.map((item) => ({ ...item, sourceObservation: "" })))).toBeNull();
    expect(verifiedLeadEvidenceDocumentIds(complete.map((item) => ({ ...item, assessment: "supports" })))).toBeNull();
  });

  it("does not count unreviewed RSS, GDELT, or uncleared Hacker News as independent operators", () => {
    for (const source_type of ["rss", "gdelt", "hacker-news"]) {
      expect(knownSourceOperator({ source_type, source_domain: "publisher.example", raw_metadata_json: { publisher: "Publisher" } })).toBeNull();
    }
  });
});
