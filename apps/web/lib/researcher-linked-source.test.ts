import { describe, expect, it } from "vitest";
import {
  isPublishableResearcherLinkedCitation,
  prepareResearcherLinkedSource,
  verifyStackExchangeCitations,
  type ResearcherLinkedCitationInput,
} from "./researcher-linked-source";

const now = Date.parse("2026-10-06T12:00:00Z");
const id = "44444444-4444-4444-8444-444444444444";
const valid = {
  id: "bluesky:at://did:plc:author/app.bsky.feed.post/abc123",
  title: "Public post by @researcher.example",
  url: "https://bsky.app/profile/researcher.example/post/abc123",
  timeValue: "2026-10-06T10:00:00.000Z",
  language: "en",
  attribution: "Author: @researcher.example",
  assessment: "supports" as const,
  sourceObservation: "The original public post describes a specific concern about the new policy.",
  researcherVerifiedOriginal: true as const,
};
const stackExchangeCitation: ResearcherLinkedCitationInput = {
  id: "stackexchange:https://politics.stackexchange.com/questions/12345/election-costs",
  title: "How can election promises affect public spending?",
  url: "https://politics.stackexchange.com/questions/12345/election-costs",
  timeValue: "2026-10-06T10:00:00.000Z",
  language: "en",
  attribution: "Author: Contributor",
  assessment: "supports",
  sourceObservation: "The question describes a specific claim about public spending and election promises.",
  researcherVerifiedOriginal: true,
};

describe("researcher-linked social citation gate", () => {
  it("stores reviewed first-party news and issuer links without article content or bylines", () => {
    const articleUrl = "https://www.abc.net.au/news/2026-10-06/business/123456";
    const article = prepareResearcherLinkedSource({
      ...valid,
      id: `newslink:${articleUrl}`,
      url: articleUrl,
      title: "Original article title is deliberately not stored",
      attribution: "A client-supplied author is deliberately ignored",
    }, id, now);
    expect(article).toMatchObject({
      source_type: "researcher-linked-source",
      source_name: "ABC News Australia",
      title_original: "Link-only report from ABC News Australia",
      source_url: articleUrl,
      raw_metadata_json: {
        citationProvider: "newslink",
        reviewedPublisherKey: "abc-news-australia",
        reviewedPublisherLabel: "ABC News Australia",
        attribution: "Source: ABC News Australia",
        rightsBasis: "researcher-verified canonical source link and researcher-authored note only; headline, report text, and byline not retained",
      },
    });
    expect(article).not.toHaveProperty("excerpt_original");
    const issuerUrl = "https://firmus.co/newsroom/announcement";
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: `companylink:${issuerUrl}`,
      url: issuerUrl,
      title: "Title excluded",
      attribution: "Byline excluded",
    }, id, now)).toMatchObject({
      source_name: "Firmus",
      title_original: "Link-only company disclosure from Firmus",
      raw_metadata_json: { citationProvider: "companylink", reviewedPublisherKey: "firmus" },
    });
    const surveyUrl = "https://data.verasight.io/ai/data-centers-and-household-benefits/";
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: `surveylink:${surveyUrl}`,
      url: surveyUrl,
      title: "Survey report title is not copied",
      attribution: "A supplied byline is ignored",
    }, id, now)).toMatchObject({
      source_name: "Verasight",
      title_original: "Link-only survey report from Verasight",
      raw_metadata_json: {
        citationProvider: "surveylink", reviewedPublisherKey: "verasight",
        reviewedPublisherLabel: "Verasight", attribution: "Source: Verasight",
      },
    });
  });

  it("rejects unreviewed or noncanonical link-only publisher URLs", () => {
    const url = "https://www.abc.net.au/news/2026-10-06/business/123456";
    expect(prepareResearcherLinkedSource({ ...valid, id: "newslink:https://unknown.example/story", url: "https://unknown.example/story" }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, id: `newslink:${url}?utm_source=x`, url: `${url}?utm_source=x` }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, id: `newslink:${url}`, url, timeValue: "2026-08-01T12:00:00Z" }, id, now)).toBeNull();
    expect(isPublishableResearcherLinkedCitation({ id: `newslink:${url}`, url, timeValue: "2026-09-15T00:00:00Z" })).toBe(true);
  });

  it("stores a recent supported Bluesky citation as link-only metadata", () => {
    const row = prepareResearcherLinkedSource(valid, id, now);
    expect(row).toMatchObject({
      id,
      source_type: "researcher-linked-source",
      source_name: "Bluesky public post",
      source_domain: "bsky.app",
      source_url: valid.url,
      raw_metadata_json: {
        citationProvider: "bluesky",
        attribution: valid.attribution,
        researcherLinkedOnly: true,
        postBodyDiscarded: true,
        transientPreviewDiscarded: true,
      },
    });
    expect(row).not.toHaveProperty("excerpt_original");
    expect(prepareResearcherLinkedSource({ ...valid, title: "Client-supplied copy of a post" }, id, now)?.title_original)
      .toBe("Public post by @researcher.example");
  });

  it("accepts only configured Mastodon and Lemmy canonical post hosts", () => {
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: "mastodon:123",
      url: "https://mastodon.social/@reader/12345",
    }, id, now)?.raw_metadata_json).toMatchObject({ citationProvider: "mastodon" });
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: "mastodon:community-post",
      url: "https://piaille.fr/@reader/12345",
    }, id, now)?.raw_metadata_json).toMatchObject({ citationProvider: "mastodon" });
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: "lemmy:https://lemmy.world/post/123",
      url: "https://lemmy.world/post/123",
      title: "A community discussion",
      attribution: "Lemmy author: reader",
    }, id, now)).toMatchObject({
      raw_metadata_json: { citationProvider: "lemmy" },
      title_original: "Public Lemmy post by reader",
    });
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: "lemmy:https://jlai.lu/post/123",
      url: "https://jlai.lu/post/123",
      title: "Une discussion publique",
      attribution: "Lemmy author: lecteur",
    }, id, now)).toMatchObject({
      raw_metadata_json: { citationProvider: "lemmy" },
      title_original: "Public Lemmy post by lecteur",
    });
    expect(prepareResearcherLinkedSource({
      ...valid,
      id: "mastodon:123",
      url: "https://unknown.example/@reader/12345",
    }, id, now)).toBeNull();
    const timeValue = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(isPublishableResearcherLinkedCitation({ id: "mastodon:123", url: "https://mastodon.social/@reader/12345", timeValue })).toBe(true);
    expect(isPublishableResearcherLinkedCitation({ id: "mastodon:123", url: "https://other.social/@reader/12345", timeValue })).toBe(false);
    expect(isPublishableResearcherLinkedCitation({
      id: `stackexchange:${stackExchangeCitation.url}`,
      url: stackExchangeCitation.url,
      timeValue: stackExchangeCitation.timeValue,
    })).toBe(true);
  });

  it("rejects noncanonical, stale, future, unreviewed, or unattributed citations", () => {
    expect(prepareResearcherLinkedSource({ ...valid, url: "http://bsky.app/profile/a/post/b" }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, url: `${valid.url}?tracking=1` }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, timeValue: "2026-09-20T12:00:00Z" }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, timeValue: "2026-10-07T12:00:00Z" }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, researcherVerifiedOriginal: false as never }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, attribution: "" }, id, now)).toBeNull();
    expect(prepareResearcherLinkedSource({ ...valid, sourceObservation: "short" }, id, now)).toBeNull();
  });

  it("verifies fresh Stack Exchange citations against the keyless API and retains no question body", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("api.stackexchange.com");
      expect(url.pathname).toBe("/2.3/questions/12345");
      expect(url.searchParams.get("site")).toBe("politics");
      return new Response(JSON.stringify({ items: [{
        question_id: 12345,
        title: "How can election promises affect public spending?",
        link: stackExchangeCitation.url,
        creation_date: Date.parse(stackExchangeCitation.timeValue) / 1000,
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Contributor", link: "https://politics.stackexchange.com/users/7/contributor" },
        body: "This field must not be retained.",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const verified = await verifyStackExchangeCitations([stackExchangeCitation], fetcher, now);
    expect(verified?.get(stackExchangeCitation.url)).toMatchObject({
      site: "politics", siteLabel: "Politics Stack Exchange", title: stackExchangeCitation.title,
      author: "Contributor", url: stackExchangeCitation.url,
    });
    const row = prepareResearcherLinkedSource(stackExchangeCitation, id, now, verified?.get(stackExchangeCitation.url));
    expect(row).toMatchObject({
      source_type: "researcher-linked-source", source_name: "Politics Stack Exchange",
      title_original: stackExchangeCitation.title,
      raw_metadata_json: {
        citationProvider: "stackexchange", contentLicense: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", titleUnmodified: true,
      },
    });
    expect(row?.raw_metadata_json).not.toHaveProperty("body");
  });

  it("rejects unlicensed, mismatched, stale, and provider-throttled Stack Exchange evidence", async () => {
    const makeFetcher = (overrides: Record<string, unknown> = {}, status = 200) => async () => new Response(JSON.stringify({
      items: [{
        question_id: 12345, title: stackExchangeCitation.title, link: stackExchangeCitation.url,
        creation_date: Date.parse(stackExchangeCitation.timeValue) / 1000, content_license: "CC BY-SA 4.0",
        owner: { display_name: "Contributor", link: "https://politics.stackexchange.com/users/7/contributor" },
        ...overrides,
      }],
    }), { status, headers: { "content-type": "application/json" } });
    expect(await verifyStackExchangeCitations([stackExchangeCitation], makeFetcher({ content_license: "CC BY-SA 3.0" }), now)).toBeNull();
    expect(await verifyStackExchangeCitations([stackExchangeCitation], makeFetcher({ title: "Different title" }), now)).toBeNull();
    expect(await verifyStackExchangeCitations([stackExchangeCitation], makeFetcher({}), now + 8 * 86400000)).toBeNull();
    expect(await verifyStackExchangeCitations([stackExchangeCitation], async () => new Response("{}", { status: 429 }), now)).toBeNull();
    expect(await verifyStackExchangeCitations([stackExchangeCitation], makeFetcher({ owner: { display_name: "Contributor", link: "https://evil.example/users/7/contributor" } }), now)).toBeNull();
    expect(await verifyStackExchangeCitations([stackExchangeCitation], makeFetcher({ title: "&#999999999999999999999;" }), now)).toBeNull();
  });
});
