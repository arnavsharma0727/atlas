import { describe, expect, it } from "vitest";
import { matchesOriginalTitlePhrase, matchingOriginalTitlePhrases, matchingPublisherEvidence, parseOriginalTitlePhrases, toPublisherEvidence } from "./publisher-evidence";

const now = Date.parse("2026-10-01T12:00:00Z");
const recent = "2026-10-01T10:00:00Z";

describe("reviewed publisher evidence", () => {
  it("filters headline phrases literally across Latin, accented, and CJK text", () => {
    expect(matchesOriginalTitlePhrase("Interest rates rise", "interest rates")).toBe(true);
    expect(matchesOriginalTitlePhrase("Markets await decisions", "rate")).toBe(false);
    expect(matchesOriginalTitlePhrase("How to build an AI tool", "AI")).toBe(true);
    expect(matchesOriginalTitlePhrase("Said investors react", "AI")).toBe(false);
    expect(matchesOriginalTitlePhrase("La inflación aumenta", "inflación")).toBe(true);
    expect(matchesOriginalTitlePhrase("日本銀行の政策", "日本銀行")).toBe(true);
    expect(matchesOriginalTitlePhrase("한국은행의 결정", "한국은행")).toBe(true);
    expect(matchesOriginalTitlePhrase("Anything", "")).toBe(true);
  });

  it("does not render unfiltered recent feed items before a topic is chosen", () => {
    const items = [{ title: "Interest rates rise" }, { title: "A climate report" }];
    expect(matchingPublisherEvidence(items, "")).toEqual([]);
    expect(matchingPublisherEvidence(items, "interest rates")).toEqual([items[0]]);
  });

  it("keeps researcher-entered language variants separate and reports exact title matches", () => {
    const items = [
      { title: "Inflation rises in the latest report" },
      { title: "La inflación sube" },
      { title: "인플레이션 전망" },
      { title: "Interest rates change" },
    ];
    const phrases = "inflation\ninflación; 인플레이션\ninflation";
    expect(parseOriginalTitlePhrases(phrases)).toEqual(["inflation", "inflación", "인플레이션"]);
    expect(matchingPublisherEvidence(items, phrases)).toEqual(items.slice(0, 3));
    expect(matchingOriginalTitlePhrases(items[1].title, phrases)).toEqual(["inflación"]);
    expect(matchingOriginalTitlePhrases(items[2].title, phrases)).toEqual(["인플레이션"]);
  });

  it("accepts localized Global Voices titles with attribution and CC BY metadata only", () => {
    const result = toPublisherEvidence({
      id: "gv-1", source_type: "licensed-reporting", source_name: "Global Voices · Spanish edition",
      source_domain: "es.globalvoices.org", language_code: "es", title_original: "Titular",
      source_url: "https://es.globalvoices.org/2026/10/01/story/", published_at: recent,
      raw_metadata_json: {
        publisher: "Global Voices", author: "Reporter", editionLabel: "Spanish",
        licenseUrl: "https://creativecommons.org/licenses/by/3.0/", titleUnmodified: true,
        articleBodyDiscarded: true, mediaDiscarded: true,
      },
    }, now);
    expect(result).toMatchObject({
      title: "Titular", language: "es", evidenceClass: "news coverage",
      sourceOperatorKey: "global-voices", sourceOperatorLabel: "Global Voices",
      licenseName: "CC BY 3.0", attribution: "Reporter",
    });
    expect(result).not.toHaveProperty("excerpt");
  });

  it("requires the recorded no-derivatives rights and body-discard metadata for The Conversation", () => {
    const row = {
      id: "tc-1", source_type: "licensed-analysis", source_name: "The Conversation · AU",
      source_domain: "theconversation.com", language_code: "en", title_original: "Analysis title",
      source_url: "https://theconversation.com/example", published_at: recent,
      raw_metadata_json: {
        publisher: "The Conversation", edition: "au", authors: ["Author"],
        rightsStatement: "Creative Commons Attribution-No Derivatives", attributionRequired: true,
        derivativesAllowed: false, contentPolicy: "unmodified-title-author-link-date-only",
        summaryDiscarded: true, articleBodyDiscarded: true,
      },
    };
    expect(toPublisherEvidence(row, now)?.sourceOperatorKey).toBe("the-conversation");
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, derivativesAllowed: true } }, now)).toBeNull();
  });

  it("classifies reviewed link-only news and issuer citations without retaining supplied headlines", () => {
    const base = {
      id: "external-1", source_type: "researcher-linked-source", source_name: "ABC News Australia",
      source_domain: "www.abc.net.au", language_code: "en",
      source_url: "https://www.abc.net.au/news/2026-10-01/business/123456",
      published_at: recent,
      raw_metadata_json: {
        citationProvider: "newslink", reviewedPublisherKey: "abc-news-australia",
        reviewedPublisherLabel: "ABC News Australia", attribution: "Source: ABC News Australia",
        researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
      },
      title_original: "Link-only report from ABC News Australia",
    };
    expect(toPublisherEvidence(base, now)).toMatchObject({
      title: "Link-only report from ABC News Australia", evidenceClass: "news coverage",
      sourceOperatorKey: "abc-news-australia", sourceOperatorLabel: "ABC News Australia",
      context: "Researcher-verified first-party report link; headline, article text, and byline are not retained",
    });
    expect(toPublisherEvidence({ ...base, raw_metadata_json: { ...base.raw_metadata_json, reviewedPublisherKey: "fake" } }, now)).toBeNull();

    const issuer = {
      ...base,
      source_name: "Firmus", source_domain: "firmus.co",
      source_url: "https://firmus.co/newsroom/announcement",
      title_original: "Link-only company disclosure from Firmus",
      raw_metadata_json: {
        citationProvider: "companylink", reviewedPublisherKey: "firmus",
        reviewedPublisherLabel: "Firmus", attribution: "Source: Firmus",
        researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
      },
    };
    expect(toPublisherEvidence(issuer, now)).toMatchObject({
      evidenceClass: "official company disclosure", sourceOperatorKey: "firmus",
      context: "Researcher-verified issuer disclosure link; company claims are not independent verification",
    });

    const survey = {
      ...base,
      source_name: "Verasight", source_domain: "data.verasight.io",
      source_url: "https://data.verasight.io/ai/data-centers-and-household-benefits/",
      title_original: "Link-only survey report from Verasight",
      raw_metadata_json: {
        citationProvider: "surveylink", reviewedPublisherKey: "verasight",
        reviewedPublisherLabel: "Verasight", attribution: "Source: Verasight",
        researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
      },
    };
    expect(toPublisherEvidence(survey, now)).toMatchObject({
      evidenceClass: "survey research", sourceOperatorKey: "verasight",
      context: "Researcher-verified survey report link; headline, report content, and byline are not retained",
    });
  });

  it("requires an allowed URL, intact Typst CC BY fields, and a fresh publication date", () => {
    const row = {
      id: "typst-1", source_type: "licensed-forum", source_name: "Typst Forum",
      source_domain: "forum.typst.app", language_code: null, title_original: "Topic",
      source_url: "https://forum.typst.app/t/topic/123", published_at: recent,
      raw_metadata_json: {
        publisher: "Typst Forum", author: "Member", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        titleUnmodified: true, postBodyAndSummaryDiscarded: true,
      },
    };
    expect(toPublisherEvidence(row, now)?.evidenceClass).toBe("community forum");
    expect(toPublisherEvidence({ ...row, source_url: "https://forum.typst.app.evil.example/t/topic/123" }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, published_at: "2026-09-20T00:00:00Z" }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, published_at: "2026-10-02T00:00:00Z" }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, licenseUrl: "https://example.org/" } }, now)).toBeNull();
  });

  it("accepts only licensed, attributed Fedora Discussion titles without reply content", () => {
    const row = {
      id: "fedora-1", source_type: "licensed-forum", source_name: "Fedora Discussion · community forum",
      source_domain: "discussion.fedoraproject.org", language_code: "en", title_original: "A Linux topic",
      source_url: "https://discussion.fedoraproject.org/t/linux-topic/1234", published_at: recent,
      raw_metadata_json: {
        publisher: "Fedora Discussion", author: "member_name",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        titleUnmodified: true, topicBodyAndRepliesDiscarded: true, profileDetailsDiscarded: true,
      },
    };
    expect(toPublisherEvidence(row, now)).toMatchObject({
      evidenceClass: "community forum", attribution: "member_name",
      licenseName: "CC BY-SA 4.0", sourceOperatorKey: "fedora-discussion",
      sourceOperatorLabel: "Fedora Discussion",
    });
    expect(toPublisherEvidence({ ...row, source_url: "https://fedoraproject.org/t/linux-topic/1234" }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, topicBodyAndRepliesDiscarded: false } }, now)).toBeNull();
  });

  it("accepts only stored Stack Exchange titles with exact query, attribution, and CC BY-SA metadata", () => {
    const row = {
      id: "se-1", source_type: "stack-exchange", source_name: "Politics Stack Exchange",
      source_domain: "politics.stackexchange.com", language_code: "en",
      title_original: "How do electricity tariffs affect household prices?",
      source_url: "https://politics.stackexchange.com/questions/12345/example",
      published_at: recent,
      raw_metadata_json: {
        attributionName: "Reader One", contentLicense: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", query: "electricity tariffs",
      },
    };
    expect(toPublisherEvidence(row, now)).toMatchObject({
      evidenceClass: "expert Q&A", sourceOperatorKey: "stack-exchange",
      attribution: "Author: Reader One", licenseName: "CC BY-SA 4.0",
    });
    expect(toPublisherEvidence({ ...row, source_url: "https://politics.stackexchange.com.evil.example/questions/12345" }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, query: "semiconductor earnings" } }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, contentLicense: "CC BY-NC-SA 4.0" } }, now)).toBeNull();
  });

  it("accepts the broad recent Stack Exchange feed only with its explicit title-only license metadata", () => {
    const row = {
      id: "se-feed-1", source_type: "stack-exchange", source_name: "Quantitative Finance Stack Exchange",
      source_domain: "quant.stackexchange.com", language_code: "en",
      title_original: "How can volatility be compared across markets?",
      source_url: "https://quant.stackexchange.com/questions/12345/volatility",
      published_at: recent,
      raw_metadata_json: {
        attributionName: "Reader One", attributionUrl: "https://quant.stackexchange.com/users/12/reader-one",
        contentLicense: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        site: "quant", collectionMethod: "recent-licensed-question-feed",
        titleUnmodified: true,
        questionBodyRetained: false, answerBodyRetained: false,
      },
    };
    expect(toPublisherEvidence(row, now)).toMatchObject({
      evidenceClass: "expert Q&A", source: "Quantitative Finance Stack Exchange",
      sourceOperatorKey: "stack-exchange", licenseName: "CC BY-SA 4.0",
      context: expect.stringContaining("not a general public-opinion sample"),
    });
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, answerBodyRetained: true } }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, source_url: "https://economics.stackexchange.com/questions/12345/volatility" }, now)).toBeNull();
  });

  it("renders only link-only, recent, allowlisted researcher citations without social post text", () => {
    const row = {
      id: "external-1", source_type: "researcher-linked-source", source_name: "Bluesky public post",
      source_domain: "bsky.app", language_code: "en", title_original: "Public post by @researcher.example",
      source_url: "https://bsky.app/profile/researcher.example/post/abc123", published_at: recent,
      raw_metadata_json: {
        citationProvider: "bluesky", attribution: "Author: @researcher.example",
        researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
      },
    };
    expect(toPublisherEvidence(row, now)).toMatchObject({
      evidenceClass: "social discussion", sourceOperatorKey: "bluesky", sourceOperatorLabel: "Bluesky",
      attribution: "Author: @researcher.example", context: expect.stringContaining("no post text"),
    });
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, postBodyDiscarded: false } }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, source_url: "https://bsky.app.evil.example/profile/a/post/b" }, now)).toBeNull();
  });

  it("renders a link-only citation from a configured language/community Mastodon server", () => {
    const row = {
      id: "external-mastodon-1", source_type: "researcher-linked-source", source_name: "Mastodon · piaille.fr",
      source_domain: "piaille.fr", language_code: "fr", title_original: "Public post by @reader",
      source_url: "https://piaille.fr/@reader/12345", published_at: recent,
      raw_metadata_json: {
        citationProvider: "mastodon", attribution: "Author: @reader",
        researcherLinkedOnly: true, postBodyDiscarded: true, transientPreviewDiscarded: true,
      },
    };
    expect(toPublisherEvidence(row, now)).toMatchObject({
      evidenceClass: "social discussion", sourceOperatorKey: "mastodon-network",
      context: expect.stringContaining("no post text"),
    });
  });

  it("renders a provider-verified Stack Exchange citation with CC BY-SA attribution", () => {
    const row = {
      id: "external-se-1", source_type: "researcher-linked-source", source_name: "Politics Stack Exchange",
      source_domain: "politics.stackexchange.com", language_code: "en",
      title_original: "How can election promises affect public spending?",
      source_url: "https://politics.stackexchange.com/questions/12345/election-costs", published_at: recent,
      raw_metadata_json: {
        citationProvider: "stackexchange", attribution: "Author: Contributor",
        attributionUrl: "https://politics.stackexchange.com/users/7/contributor", site: "politics",
        contentLicense: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        titleUnmodified: true, researcherLinkedOnly: true, postBodyDiscarded: true,
        transientPreviewDiscarded: true,
      },
    };
    expect(toPublisherEvidence(row, now)).toMatchObject({
      evidenceClass: "expert Q&A", sourceOperatorKey: "stack-exchange",
      attribution: "Author: Contributor", attributionUrl: row.raw_metadata_json.attributionUrl,
      licenseName: "CC BY-SA 4.0", licenseUrl: row.raw_metadata_json.licenseUrl,
    });
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, contentLicense: "CC BY-SA 3.0" } }, now)).toBeNull();
    expect(toPublisherEvidence({ ...row, raw_metadata_json: { ...row.raw_metadata_json, attributionUrl: "https://evil.example/users/7/contributor" } }, now)).toBeNull();
  });
});
