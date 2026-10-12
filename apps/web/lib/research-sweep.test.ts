import { describe, expect, it, vi } from "vitest";
import { runResearchSweep } from "./research-sweep";
import { filterResultsToTopic, hasMarketSignalTerms, isIndependentDiscussionEvidence, selectBalancedEvidence } from "./market-summary";
import { citationKey } from "./perspective-snapshot";
import { resetStackExchangeThrottleStatus, searchLiveDiscussion } from "./live-topic-search";

const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("runResearchSweep", () => {
  it("labels Bluesky creation time as client-declared and unverified, not indexing or event time", async () => {
    const fetcher = vi.fn(async () => Response.json({ posts: [{
      uri: "at://did:plc:abc/app.bsky.feed.post/1", author: { handle: "reader.example" },
      record: { text: "Solar demand is slowing.", createdAt: new Date(NOW - 1000).toISOString() },
      indexedAt: new Date(NOW).toISOString(),
    }] }));
    const [result] = await runResearchSweep("solar", { lemmy: false, bluesky: true }, fetcher, NOW);
    expect(result.evidence[0].timeLabel).toBe("Client-declared created time · unverified");
    expect(result.evidence[0].timeValue).toBe(new Date(NOW - 1000).toISOString());
    expect(result.sourceNote).toContain("never indexedAt");
    expect(result.sourceNote).toContain("not an independently established publication or event date");
  });
  it("preserves Mastodon raw returns and safety exclusions before the separate topic screen", async () => {
    const base = { visibility: "public", created_at: new Date(NOW - 1000).toISOString(), language: "en",
      account: { acct: "fixture", url: "https://mastodon.social/@fixture" } };
    const fetcher = vi.fn(async () => Response.json([
      { ...base, id: "1", url: "https://mastodon.social/@fixture/1", content: "<p>Solar demand is slowing.</p>" },
      { ...base, id: "2", url: "https://mastodon.social/@fixture/2", content: "<p>Unrelated breakfast.</p>" },
      { ...base, id: "3", url: "https://mastodon.social/@fixture/3", content: "<p>Solar prices</p>", visibility: "private" },
      null,
    ]));
    const results = await runResearchSweep("solar", { lemmy: false, mastodon: { hashtag: "solar", instance: "mastodon.social" } }, fetcher, NOW);
    expect(results[0]).toMatchObject({ status: "complete", providerReturnedCount: 4, adapterExcludedCount: 2 });
    const [filtered] = filterResultsToTopic(results, "solar");
    expect(filtered).toMatchObject({ providerReturnedCount: 4, adapterExcludedCount: 2, topicExcludedCount: 1 });
    expect(filtered.evidence).toHaveLength(1);
    expect(filtered.sourceNote).toContain("2 excluded by freshness");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps Mastodon safety-only empty samples distinguishable from an empty timeline", async () => {
    const [result] = await runResearchSweep("solar", { lemmy: false, mastodon: { hashtag: "solar", instance: "mastodon.social" } }, async () => Response.json([null]), NOW);
    expect(result).toMatchObject({ status: "complete", evidence: [], providerReturnedCount: 1, adapterExcludedCount: 1 });
    expect(result.sourceNote).toContain("1 API records returned");
  });
  it("keeps original and price-context searches auditable with an explicit provider language filter", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ posts: [] }));
    const results = await runResearchSweep("GPU", { lemmy: false, bluesky: true, blueskyQueries: ["GPU", "GPU prices"], blueskyLanguage: "en" }, fetcher, NOW);
    expect(results.map(({ query }) => query)).toEqual(["GPU", "GPU prices"]);
    expect(results.every(({ window }) => window.includes("provider language filter: en"))).toBe(true);
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).searchParams.get("lang") === "en")).toBe(true);
  });
  it("shows the bounded PyTorch sample separately, with partial status and no AI candidates", async () => {
    const fetcher = vi.fn(async () => Response.json({ sample: {
      evidence: [{ id: "pytorch:1:1", title: "GPU deployment", url: "https://discuss.pytorch.org/t/1/1", source: "PyTorch Forums", evidenceClass: "community forum", language: "Not reported", timeLabel: "Original post created", timeValue: new Date(NOW).toISOString(), transientPreview: "GPU deployment memory constraints are limiting our model sizes.", summaryEligible: false }],
      feedCount: 30, matchingTopics: 5, failedTopics: 1, excludedTopics: 0, retrievedAt: new Date(NOW - 1000).toISOString(),
    } }));
    const [result] = await runResearchSweep("GPU", { pytorch: true, lemmy: false }, fetcher, NOW);
    expect(result.status).toBe("partial");
    expect(result.sourceNote).toContain("5 recent title matches");
    expect(result.coverageNote).toContain("not reported");
    expect(selectBalancedEvidence([result], new Map([[citationKey(result.key, result.evidence[0].id), "C1"]]))).toEqual([]);
    expect(result.retrievedAt).toBe(new Date(NOW - 1000).toISOString());
  });
  it("does not call PyTorch for unrelated queries", async () => {
    const fetcher = vi.fn(async () => Response.json({ message: { items: [] } }));
    const results = await runResearchSweep("oil", { pytorch: true, crossref: true, lemmy: false }, fetcher, NOW);
    expect(results.some((result) => result.key === "pytorch")).toBe(false);
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it("keeps original Mastodon hashtag commentary eligible but still excludes article sharing", async () => {
    const tag = { name: "Solar", url: "https://mastodon.social/tags/solar" };
    const hashtag = '<a href="https://mastodon.social/tags/solar" class="mention hashtag" rel="tag">#<span>Solar</span></a>';
    const base = { visibility: "public", created_at: new Date(NOW - 1000).toISOString(), language: "en",
      tags: [tag], account: { display_name: "Fixture", acct: "fixture", url: "https://mastodon.social/@fixture" } };
    const fetcher = vi.fn(async () => Response.json([
      { ...base, id: "original", url: "https://mastodon.social/@fixture/1", content: `<p>Solar demand is slowing. ${hashtag}</p>` },
      { ...base, id: "article", url: "https://mastodon.social/@fixture/2", content: `<p>Solar supply is rising. ${hashtag} <a href="https://publisher.example/report">report</a></p>` },
    ]));
    const [result] = await runResearchSweep("solar", { lemmy: false, mastodon: { hashtag: "Solar", instance: "mastodon.social" } }, fetcher, NOW);
    expect(result.evidence.map(({ linkSharing }) => linkSharing)).toEqual([false, true]);
    expect(result.evidence[0].context).not.toContain("includes an external link");
    const citations = new Map(result.evidence.map((item, index) => [citationKey(result.key, item.id), `C${index + 1}`]));
    const selected = selectBalancedEvidence([result], citations, 8, new Set(), "en",
      (item) => isIndependentDiscussionEvidence(item) && hasMarketSignalTerms(item));
    expect(selected.map(({ citationId }) => citationId)).toEqual(["C1"]);
  });

  it("loads BIS statistics only as separately labeled FX context, not summary evidence", async () => {
    const row = {
      id: "bis-eer:KR:N:2026-08", title: "South Korea · nominal effective exchange rate (broad basket)",
      url: "https://data.bis.org/topics/EER/BIS%2CWS_EER%2C1.0/M.N.B.KR", source: "Bank for International Settlements (BIS)",
      evidenceClass: "official statistical data" as const, language: "Not applicable", timeLabel: "Latest monthly observation",
      timeValue: "2026-08", context: "Index 89.15 (2020 = 100).", summaryEligible: false,
      licenseUrl: "https://data.bis.org/help/legal", sourceOperatorKey: "bis-statistics",
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/research/bis");
      return Response.json({ evidence: [row], missingSeries: [], staleSeries: [], failedAreas: [], retrievedAt: "2026-10-12T02:15:00Z" });
    }) as unknown as typeof fetch;
    const [result] = await runResearchSweep("USD currency", { bisCountryCode: "KR", lemmy: false }, fetcher, NOW);
    expect(result).toMatchObject({
      key: "bis-effective-exchange",
      status: "complete",
      query: "USD currency",
      evidence: [row],
      sourceNote: expect.stringContaining("not a bilateral spot quote"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks World Bank context partial when a requested geography has no usable annual observation", async () => {
    const fetcher = vi.fn(async () => Response.json([{}, [
      { country: { id: "US", value: "United States" }, countryiso3code: "USA", indicator: { id: "FP.CPI.TOTL.ZG" }, date: "2025", value: 2.9 },
    ]]));
    const [result] = await runResearchSweep("inflation", { worldBankCountryCode: "KR", lemmy: false }, fetcher, NOW);
    expect(result).toMatchObject({
      key: "world-bank-macro",
      status: "partial",
      coverageNote: expect.stringContaining("KOR, WLD"),
    });
    expect(result.evidence).toHaveLength(1);
  });

  it("marks the free EIA source not searched until a private API key is configured", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: "not_configured", error: "not configured" }, { status: 503 }));
    const [result] = await runResearchSweep("crude oil", { eiaEnergyPrices: true, lemmy: false }, fetcher, NOW);
    expect(result).toMatchObject({
      key: "eia-energy-prices",
      status: "not-searched",
      error: expect.stringContaining("free EIA_API_KEY"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks EIA benchmark coverage partial when only one crude series has observations", async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{
      id: "eia:RWTC:2026-09-29", title: "WTI", url: "https://www.eia.gov/opendata/browser/petroleum/pri/spt?series=RWTC",
      source: "EIA", evidenceClass: "official statistical data", language: "Not applicable", timeLabel: "Observation date",
      timeValue: "2026-09-29T00:00:00.000Z", context: "U.S. benchmark only.",
    }] }));
    const [result] = await runResearchSweep("crude oil", { eiaEnergyPrices: true, lemmy: false }, fetcher, NOW);
    expect(result).toMatchObject({
      key: "eia-energy-prices",
      status: "partial",
      coverageNote: expect.stringContaining("Europe Brent crude spot"),
    });
    expect(result.evidence).toHaveLength(1);
  });

  it("flags stale EIA daily observations instead of presenting them as current", async () => {
    const fetcher = vi.fn(async () => Response.json({ evidence: [{
      id: "eia:RNGWHHD:2026-08-01", title: "Henry Hub", url: "https://www.eia.gov/opendata/browser/natural-gas/pri/fut?series=RNGWHHD",
      source: "EIA", evidenceClass: "official statistical data", language: "Not applicable", timeLabel: "Observation date",
      timeValue: "2026-08-01T00:00:00.000Z", context: "U.S. benchmark only.",
    }] }));
    const [result] = await runResearchSweep("natural gas", { eiaEnergyPrices: true, lemmy: false }, fetcher, NOW);
    expect(result.status).toBe("partial");
    expect(result.coverageNote).toContain("more than 14 days old");
  });

  it("uses a body-less Lemmy market-post title as transient AI evidence without duplicating it in the source preview", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith("/site")
      ? Response.json({ all_languages: [{ id: 37, code: "en", name: "English" }] })
      : Response.json({ posts: [{
      post: {
        id: 31,
        ap_id: "https://lemmy.world/post/31",
        name: "Chip demand rises as inventory tightens",
        body: "",
        published: new Date(NOW - 60_000).toISOString(),
        language_id: 37,
      },
      creator: { name: "Member", actor_id: "https://lemmy.world/u/member" },
      community: { name: "economy" },
    }] }));
    const [result] = await runResearchSweep("chip demand", { lemmy: true, lemmyInstances: ["lemmy.world"] }, fetcher, NOW);
    const item = result.evidence[0];
    expect(item).toMatchObject({ title: "Chip demand rises as inventory tightens", transientPreview: "Chip demand rises as inventory tightens" });
    expect(item.language).toBe("en");
    expect(result.sourceNote).toContain("lemmy.world's live /api/v3/site language catalog");
    expect(item.context).toContain("post title is the only transient discussion excerpt");
    expect(hasMarketSignalTerms({ excerpt: item.transientPreview!, language: item.language })).toBe(true);
    expect(selectBalancedEvidence([result], new Map([[citationKey(result.key, item.id), "C1"]]))).toEqual([
      expect.objectContaining({ citationId: "C1", excerpt: "Chip demand rises as inventory tightens", title: "Public discussion post" }),
    ]);
    expect(item.transientPreview).not.toBeUndefined();
  });

  it("keeps a Lemmy language ID unresolved when that same instance catalog has no matching entry", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith("/site")
      ? Response.json({ all_languages: [{ id: 37, code: "en", name: "English" }] })
      : Response.json({ posts: [{
        post: { id: 32, ap_id: "https://jlai.lu/post/32", name: "Market supply discussion", published: new Date(NOW - 60_000).toISOString(), language_id: 999 },
        creator: { name: "member", actor_id: "https://jlai.lu/u/member" },
        community: { name: "economie" },
      }] }));
    const [result] = await runResearchSweep("market supply", { lemmy: true, lemmyInstances: ["jlai.lu"] }, fetcher, NOW);
    expect(result.evidence[0].language).toContain("unmapped by jlai.lu");
    expect(result.sourceNote).toContain("1 post language ID was not found");
  });

  it("keeps Lemmy attachment headlines citable but excludes them from independent discussion summaries", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith("/site")
      ? Response.json({ all_languages: [{ id: 37, code: "en", name: "English" }] })
      : Response.json({ posts: [{
        post: { id: 33, ap_id: "https://lemmy.world/post/33", name: "Chip demand rises as inventory tightens", url: "https://publisher.example/chip-demand", published: new Date(NOW - 60_000).toISOString(), language_id: 37 },
        creator: { name: "member", actor_id: "https://lemmy.world/u/member" }, community: { name: "economy" },
      }] }));
    const [result] = await runResearchSweep("chip demand", { lemmy: true }, fetcher, NOW);
    const item = result.evidence[0];
    expect(item.linkSharing).toBe(true);
    expect(item.context).toContain("includes an external link");
    expect(result.sourceNote).toContain("Outgoing API attachments count as link-sharing");
    expect(selectBalancedEvidence([result], new Map([[citationKey(result.key, item.id), "C1"]]), 8, new Set(), undefined, isIndependentDiscussionEvidence)).toEqual([]);
    expect(item.url).toBe("https://lemmy.world/post/33");
  });

  it("retains Lemmy's raw provider count across moderation and subsequent topic filtering", async () => {
    const make = (id: number, title: string, removed = false) => ({
      post: { id, ap_id: `https://lemmy.world/post/${id}`, name: title, removed, published: new Date(NOW - 60_000).toISOString(), language_id: 37 },
      creator: { name: "member" }, community: { name: "economy" },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith("/site")
      ? Response.json({ all_languages: [{ id: 37, code: "en", name: "English" }] })
      : Response.json({ posts: [make(1, "Chip demand increased"), make(2, "Unrelated gardening discussion"), make(3, "Chip demand increased", true)] }));
    const results = await runResearchSweep("chip demand", { lemmy: true }, fetcher, NOW);
    expect(results[0].providerReturnedCount).toBe(3);
    expect(results[0].sourceNote).toContain("1 excluded by freshness, moderation");
    const [screened] = filterResultsToTopic(results, "chip demand", "chip demand");
    expect(screened.providerReturnedCount).toBe(3);
    expect(screened.topicExcludedCount).toBe(1);
    expect(screened.evidence).toHaveLength(1);
  });

  it("marks a malformed Lemmy payload unavailable instead of claiming an empty successful search", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "schema changed" }));
    const [result] = await runResearchSweep("chip demand", { lemmy: true }, fetcher, NOW);
    expect(result.status).toBe("unavailable");
    expect(result.error).toContain("unrecognized post-search response");
    expect(result.providerReturnedCount).toBeUndefined();
  });

  it("keeps MANA crowd forecasts separate from discussion summaries", async () => {
    const fetcher = vi.fn(async () => Response.json([{
      id: "market-1",
      question: "Will Bitcoin exceed $100,000 by year end?",
      url: "https://manifold.markets/forecaster/bitcoin-over-100k",
      probability: 0.61,
      volume24Hours: 123,
      totalLiquidity: 800,
      closeTime: NOW + 86400000,
      lastUpdatedTime: NOW - 1000,
      isResolved: false,
      outcomeType: "BINARY",
      token: "MANA",
    }]));
    const results = await runResearchSweep("bitcoin", { manifoldForecasts: true, lemmy: false }, fetcher, NOW);
    const evidence = results[0].evidence[0];

    expect(results[0]).toMatchObject({ key: "manifold-forecasts", status: "complete", evidence: [expect.objectContaining({ evidenceClass: "crowd forecast" })] });
    expect(evidence.context).toContain("61.0% YES");
    expect(evidence.context).toContain("MANA is virtual play money");
    expect(evidence.transientPreview).toBeUndefined();
    expect(selectBalancedEvidence(results, new Map())).toEqual([]);
  });

  it("exposes Bluesky text only as a transient result preview", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ posts: [{
      uri: "at://did:plc:reader/app.bsky.feed.post/xyz",
      record: { text: "A current public conversation", createdAt: new Date(NOW - 60_000).toISOString(), langs: ["en"] },
      author: { handle: "reader.example" },
    }] })));
    const results = await runResearchSweep("markets", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      bluesky: true,
    }, fetcher, NOW);

    expect(results[0].evidence[0]).toMatchObject({
      id: "bluesky:at://did:plc:reader/app.bsky.feed.post/xyz",
      transientPreview: "A current public conversation",
    });
  });

  it("keeps manually supplied Bluesky language variants separate and query-labelled", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const term = url.searchParams.get("q")!;
      requested.push(term);
      const isKorean = term.includes("데이터센터");
      return new Response(JSON.stringify({ posts: [{
        uri: `at://did:plc:${isKorean ? "ko" : "en"}/app.bsky.feed.post/one`,
        record: { text: isKorean ? "전력망 연결 논의" : "Grid connection discussion", createdAt: new Date(NOW - 60_000).toISOString(), langs: [isKorean ? "ko" : "en"] },
        author: { handle: isKorean ? "reader-ko.example" : "reader-en.example" },
      }] }));
    });
    const results = await runResearchSweep("AI data center power", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      bluesky: true,
      blueskyQueries: ["AI data center power", "AI 데이터센터 전력"],
    }, fetcher, NOW);

    expect(requested).toEqual(["AI data center power", "AI 데이터센터 전력"]);
    expect(results.map(({ key, label, evidence }) => [key, label, evidence[0]?.language])).toEqual([
      ["bluesky:0", "Bluesky · search 1", "en"],
      ["bluesky:1", "Bluesky · search 2", "ko"],
    ]);
    expect(results[1].evidence[0].context).toContain("not translated or pooled");
    expect(results.flatMap(({ evidence }) => evidence).map(({ context }) => context ?? "").join(" ")).not.toContain("AI data center power");
    expect(results[0].evidence[0].sourceOperatorKey).toBe(results[1].evidence[0].sourceOperatorKey);
  });

  it("rejects repeated Bluesky phrases before making duplicate requests", async () => {
    const fetcher = vi.fn();
    await expect(runResearchSweep("topic", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      bluesky: true,
      blueskyQueries: ["topic", " TOPIC "],
    }, fetcher, NOW)).rejects.toThrow("different phrase");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("searches only researcher-entered alternate phrases and keeps their provenance separate", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requested.push((JSON.parse(String(init?.body)) as { query: string }).query);
      return new Response(JSON.stringify({ editions: [{ language: "en", edition: "English", articles: [], error: null }] }));
    });
    const results = await runResearchSweep("EV", {
      globalVoices: true,
      additionalQueries: ["electric vehicle"],
      lemmy: false,
    }, fetcher, NOW);
    expect(requested).toEqual(["EV", "electric vehicle"]);
    expect(results.map(({ query, key }) => [query, key])).toEqual([
      ["EV", "global-voices"],
      ["electric vehicle", "global-voices:alternate:1"],
    ]);
  });

  it("keeps The Conversation editions separate as licensed analysis and preserves per-edition failures", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ editions: [
      { code: "au", edition: "Australia", language: "en", error: null, articles: [{ id: "au:1", title: "Semiconductor demand outlook", url: "https://theconversation.com/au/example", publishedAt: new Date(NOW - 60_000).toISOString(), authors: ["Research Author"] }] },
      { code: "us", edition: "United States", language: "en", error: "Feed unavailable", articles: [] },
    ] })));
    const results = await runResearchSweep("semiconductor", { theConversation: true, lemmy: false }, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(results).toMatchObject([
      { key: "the-conversation:au", status: "complete", evidence: [{ evidenceClass: "expert analysis", attribution: "Author: Research Author", licenseName: expect.stringContaining("no derivatives") }] },
      { key: "the-conversation:us", status: "unavailable", error: "Feed unavailable", evidence: [] },
    ]);
    expect(JSON.stringify(results)).not.toContain("Feed summary");
  });

  it("discloses economic disambiguation for each scholarly source even when no records remain", async () => {
    const fetcher = vi.fn(async () => Response.json({ works: [], records: [] }));
    const results = await runResearchSweep("inflation", { crossref: true, openAlex: true, arxiv: true, lemmy: false }, fetcher, NOW);
    expect(results).toHaveLength(3);
    for (const source of results) {
      expect(source.query).toBe("inflation");
      expect(source.window).toContain("English-only disambiguation");
      expect(source.window).toContain("bounded upstream result set");
      expect(source.window).toContain("no stemming or translation");
      expect(source.status).toBe("complete");
      expect(source.evidence).toEqual([]);
    }
  });

  it("adds Crossref title/DOI metadata as global research context, not discussion evidence", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/research/crossref");
      expect(JSON.parse(String(init?.body))).toEqual({ query: "semiconductor" });
      return new Response(JSON.stringify({ works: [{
        doi: "10.1234/example.1", title: "Semiconductor investment and supply chains",
        url: "https://doi.org/10.1234/example.1", publisher: "Example Publisher",
        containerTitle: "Journal of Markets", publishedAt: "2026-01-01T00:00:00.000Z", publicationDate: "2026", language: "en",
      }] }));
    });
    const results = await runResearchSweep("semiconductor", { crossref: true, lemmy: false }, fetcher, NOW);
    expect(results).toMatchObject([{
      key: "crossref", status: "complete",
      evidence: [{ evidenceClass: "research literature", sourceOperatorKey: "crossref" }],
    }]);
    expect(results[0].evidence[0].context).toContain("Not public discussion");
    expect(results[0].evidence[0].timeValue).toBe("2026");
    expect(results[0].evidence[0].context).toContain("missing month/day are not known");
  });

  it("adds OpenAlex title-only metadata as global context, never discussion evidence", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/research/openalex");
      expect(JSON.parse(String(init?.body))).toEqual({ query: "semiconductor" });
      return Response.json({ works: [{
        id: "https://openalex.org/W12345", title: "Semiconductor supply chain resilience",
        url: "https://doi.org/10.1234/example.1", publishedAt: new Date(NOW - 60_000).toISOString(),
        workType: "article", openAccess: true,
      }] });
    });
    const results = await runResearchSweep("semiconductor", { openAlex: true, lemmy: false }, fetcher, NOW);
    expect(results).toMatchObject([{
      key: "openalex", status: "complete",
      evidence: [{ evidenceClass: "research literature", sourceOperatorKey: "openalex", licenseName: "Metadata: CC0 1.0" }],
    }]);
    expect(results[0].evidence[0].context).toContain("not public discussion");
    expect(results[0].evidence[0].transientPreview).toBeUndefined();
    expect(selectBalancedEvidence(results, new Map())).toEqual([]);
  });

  it("keeps daily ECB context separate from discussion and handles stale/missing data", async () => {
    const { parseEcbReference } = await import("./ecb-reference");
    const sample = parseEcbReference('<Envelope><Cube><Cube time="2026-09-01"><Cube currency="USD" rate="1.12"/><Cube currency="JPY" rate="170"/></Cube></Cube></Envelope>', "KR", NOW);
    const fetcher = vi.fn(async () => Response.json(sample));
    const [result] = await runResearchSweep("currency exchange rate", { ecbCountryCode: "KR", lemmy: false }, fetcher, NOW);
    expect(result).toMatchObject({ key: "ecb-reference", status: "partial", retrievedAt: sample.fetchedAt });
    expect(result.coverageNote).toContain("KRW");
    expect(result.coverageNote).toContain("seven calendar days");
    expect(result.evidence).toHaveLength(1);
    expect(selectBalancedEvidence([result], new Map())).toEqual([]);
  });

  it("does not reject server-validated ECB dates because the browser clock is slightly behind", async () => {
    const { parseEcbReference } = await import("./ecb-reference");
    const clientNow = Date.now();
    const serverNow = clientNow + 120000;
    const date = new Date(serverNow).toISOString().slice(0, 10);
    const sample = parseEcbReference(`<Envelope><Cube><Cube time="${date}"><Cube currency="USD" rate="1.12"/><Cube currency="JPY" rate="170"/></Cube></Cube></Envelope>`, "US", serverNow);
    const fetcher = vi.fn(async () => Response.json(sample));
    const [result] = await runResearchSweep("currency", { ecbCountryCode: "US", lemmy: false }, fetcher, clientNow);
    expect(result.status).toBe("complete");
    expect(result.evidence).toHaveLength(1);
    expect(result.retrievedAt).toBe(sample.fetchedAt);
  });

  it("reports SEC as disabled without any network request for older callers", async () => {
    const fetcher = vi.fn();
    const [result] = await runResearchSweep("AAPL", { secEdgar: true, lemmy: false }, fetcher, NOW);
    expect(result).toMatchObject({ key: "sec-edgar", status: "not-searched", evidence: [] });
    expect(result.error).toContain("disabled by operator policy");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("adds arXiv title metadata as preprint context without abstract text", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/research/arxiv");
      expect(JSON.parse(String(init?.body))).toEqual({ query: "semiconductor" });
      return new Response(JSON.stringify({ records: [{
        id: "2604.01234", title: "Semiconductor supply chain resilience", url: "https://arxiv.org/abs/2604.01234",
        publishedAt: new Date(NOW - 60_000).toISOString(), category: "econ.GN",
      }] }));
    });
    const results = await runResearchSweep("semiconductor", { arxiv: true, lemmy: false }, fetcher, NOW);
    expect(results).toMatchObject([{
      key: "arxiv", status: "complete",
      evidence: [{ evidenceClass: "research literature", sourceOperatorKey: "arxiv", licenseName: expect.stringContaining("CC0") }],
    }]);
    expect(results[0].evidence[0].context).toContain("not public discussion");
    expect(results[0].evidence[0]).not.toHaveProperty("transientPreview");
  });

  it("keeps short ticker searches alive and marks Stack Exchange as not searched", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/research/global-voices")) return new Response(JSON.stringify({ editions: [{ language: "en", edition: "English", articles: [], error: null }] }));
      return new Response(JSON.stringify({ hits: [] }));
    });
    const results = await runResearchSweep("EV", {
      globalVoices: true,
      stackExchangeQueries: [{ site: "economics", query: "EV" }],
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toMatchObject([
      { key: "global-voices", query: "EV", status: "complete" },
      { key: "stack-exchange:economics", query: "EV", status: "not-searched", error: expect.stringContaining("requires at least 3") },
    ]);
  });

  it("adds licensed economics, quant, and personal-finance Q&A as separate title-only sources", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search/advanced")) requests.push(url.searchParams.get("site") ?? "");
      const site = url.searchParams.get("site")!;
      return new Response(JSON.stringify({ items: [{
        question_id: 42,
        title: "Semiconductor demand outlook",
        link: `https://${site}.stackexchange.com/questions/42/example`,
        creation_date: Math.floor((NOW - 60_000) / 1000),
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Researcher", link: `https://${site}.stackexchange.com/users/9/researcher` },
      }] }));
    });
    const results = await runResearchSweep("semiconductor demand", {
      stackExchangeQueries: ["economics", "quant", "money"].map((site) => ({ site, query: "semiconductor demand" })),
      lemmy: false,
    }, fetcher, NOW);

    expect(requests).toEqual(["economics", "quant", "money"]);
    expect(results.map(({ label, evidence }) => [label, evidence[0]?.evidenceClass, evidence[0]?.licenseName])).toEqual([
      ["Economics Stack Exchange", "expert Q&A", "CC BY-SA 4.0"],
      ["Quantitative Finance Stack Exchange", "expert Q&A", "CC BY-SA 4.0"],
      ["Personal Finance & Money", "expert Q&A", "CC BY-SA 4.0"],
    ]);
    expect(results.every(({ evidence }) => evidence[0].transientPreview === undefined)).toBe(true);
  });

  it("marks Stack Exchange coverage partial when question search works but answer lookup fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        question_id: 42,
        title: "Semiconductor demand outlook",
        link: "https://economics.stackexchange.com/questions/42/example",
        creation_date: Math.floor((NOW - 60_000) / 1000),
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Researcher", link: "https://economics.stackexchange.com/users/9/researcher" },
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const [result] = await runResearchSweep("semiconductor demand", {
      stackExchangeQueries: [{ site: "economics", query: "semiconductor demand" }],
      lemmy: false,
    }, fetcher, NOW);
    expect(result.status).toBe("partial");
    expect(result.evidence).toHaveLength(1);
    expect(result.sourceNote).toContain("answer lookup was unavailable");
  });

  it("preserves partial answer-backoff coverage through a reused Stack Exchange search", async () => {
    resetStackExchangeThrottleStatus();
    const payload = { items: [{ question_id: 43, title: "Semiconductor capacity",
      link: "https://economics.stackexchange.com/questions/43/example",
      creation_date: Math.floor((NOW - 60_000) / 1000), content_license: "CC BY-SA 4.0",
      owner: { display_name: "Researcher", link: "https://economics.stackexchange.com/users/9/researcher" } }] };
    const prime = vi.fn().mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(Response.json({ items: [], backoff: 5 }));
    const fetcher = vi.fn(async () => Response.json(payload));
    try {
      await searchLiveDiscussion("semiconductor", "economics", prime, NOW);
      vi.stubGlobal("fetch", fetcher);
      const selection = { stackExchangeQueries: [{ site: "economics", query: "semiconductor capacity" }], lemmy: false };
      const first = await runResearchSweep("semiconductor capacity", selection, undefined, NOW + 1000);
      const reused = await runResearchSweep("semiconductor capacity", selection, undefined, NOW + 2000);
      for (const results of [first, reused]) {
        expect(results[0].status).toBe("partial");
        expect(results[0].evidence).toHaveLength(1);
        expect(results[0].evidence[0].retrievalIncomplete).toBe(true);
        expect(results[0].evidence[0].context).toContain("answer-endpoint backoff");
      }
      expect(fetcher).toHaveBeenCalledOnce();
      expect(reused[0].sourceNote).toContain("within the past 65 seconds");
    } finally {
      vi.unstubAllGlobals();
      resetStackExchangeThrottleStatus();
    }
  });

  it("reuses a matching live Stack Exchange request for 65 seconds", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal("fetch", fetcher);
    const query = `quota-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const first = await runResearchSweep(query, {
        stackExchangeQueries: [{ site: "economics", query }],
        lemmy: false,
      }, undefined, NOW);
      const second = await runResearchSweep(query, {
        stackExchangeQueries: [{ site: "economics", query }],
        lemmy: false,
      }, undefined, NOW + 1_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(first[0].sourceNote).toBeUndefined();
      expect(second[0].sourceNote).toContain("within the past 65 seconds");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks an overlong Stack Exchange query not-searched without truncating it or failing other sources", async () => {
    const query = `semiconductor ${"demand ".repeat(11)}`.trim();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ posts: [] })));
    const results = await runResearchSweep(query, {
      stackExchangeQueries: [{ site: "economics", query }],
      bluesky: true,
      lemmy: false,
    }, fetcher, NOW);
    const stack = results.find(({ key }) => key === "stack-exchange:economics");
    expect(stack).toMatchObject({ query, status: "not-searched" });
    expect(stack?.error).toContain("up to 80 characters");
    expect(results.find(({ key }) => key === "bluesky:0")?.status).toBe("complete");
  });

  it("flags a Bluesky sample dominated by one displayed handle", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ posts: [
      { uri: "at://did:plc:abc/app.bsky.feed.post/a", record: { text: "First distinct view", createdAt: new Date(NOW - 1000).toISOString() }, author: { handle: "one.example" } },
      { uri: "at://did:plc:abc/app.bsky.feed.post/b", record: { text: "Second distinct view", createdAt: new Date(NOW - 2000).toISOString() }, author: { handle: "one.example" } },
      { uri: "at://did:plc:abc/app.bsky.feed.post/c", record: { text: "Third distinct view", createdAt: new Date(NOW - 3000).toISOString() }, author: { handle: "one.example" } },
    ] })));
    const [result] = await runResearchSweep("markets", {
      globalVoices: false,
      bluesky: true,
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW);
    expect(result.sourceNote).toContain("one displayed handle appears in 3 of 3");
  });

  it("excludes Bluesky external cards from independent overviews even when their visible text has no URL", async () => {
    const fetcher = vi.fn(async () => Response.json({ posts: [{
      uri: "at://did:plc:abc/app.bsky.feed.post/card", author: { handle: "reader.example" },
      record: { text: "Semiconductor demand is rising.", createdAt: new Date(NOW - 1000).toISOString(), langs: ["en"] },
      embed: { $type: "app.bsky.embed.external#view", external: { uri: "https://publisher.example/report" } },
    }] }));
    const [result] = await runResearchSweep("semiconductor", { bluesky: true, lemmy: false }, fetcher, NOW);
    const item = result.evidence[0];
    expect(item.linkSharing).toBe(true);
    expect(item.context).toContain("includes an external link");
    expect(JSON.stringify(item)).not.toContain("publisher.example");
    expect(selectBalancedEvidence([result], new Map([[citationKey(result.key, item.id), "C1"]]), 8, new Set(), undefined, isIndependentDiscussionEvidence)).toEqual([]);
  });

  it("rejects duplicate and excessive alternate phrases before any provider call", async () => {
    const fetcher = vi.fn();
    await expect(runResearchSweep("topic", {
      additionalQueries: [" TOPIC "],
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW)).rejects.toThrow("must be different");
    await expect(runResearchSweep("topic", {
      additionalQueries: ["one", "two", "three", "four"],
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW)).rejects.toThrow("no more than three");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("withholds Mastodon bodies when the author attached a content warning", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{
      id: "15",
      url: "https://mastodon.social/@reader/15",
      created_at: new Date(NOW - 60_000).toISOString(),
      visibility: "public",
      content: "<p>Potentially sensitive post body</p>",
      spoiler_text: "Sensitive subject",
      language: "en",
      account: { acct: "reader", url: "https://mastodon.social/@reader" },
    }])));
    const results = await runResearchSweep("markets", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      mastodon: { hashtag: "markets", instance: "mastodon.social" },
      mastodonTermsAccepted: true,
      bluesky: false,
    }, fetcher, NOW);

    expect(results[0].evidence[0].transientPreview).toBeUndefined();
    expect(results[0].evidence[0].context).toContain("Content warning: Sensitive subject");
    expect(JSON.stringify(results)).not.toContain("Potentially sensitive post body");
  });

  it("keeps automated Mastodon posts citable but outside the AI's human discussion sample", async () => {
    const fetcher = vi.fn(async () => Response.json([{
      id: "16",
      url: "https://mastodon.social/@marketbot/16",
      created_at: new Date(NOW - 60_000).toISOString(),
      visibility: "public",
      content: "A scheduled market update",
      spoiler_text: "",
      language: "en",
      account: { acct: "marketbot", url: "https://mastodon.social/@marketbot", bot: true },
    }]));
    const results = await runResearchSweep("markets", {
      lemmy: false,
      mastodon: { hashtag: "markets", instance: "mastodon.social" },
    }, fetcher, NOW);

    expect(results[0].evidence[0].url).toBe("https://mastodon.social/@marketbot/16");
    expect(results[0].evidence[0].context).toContain("marked automated");
    expect(results[0].evidence[0].transientPreview).toBeUndefined();
    expect(selectBalancedEvidence(results, new Map())).toEqual([]);
  });

  it("searches each approved Mastodon instance separately and preserves source identity", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(new URL(String(input)).hostname);
      return new Response("[]");
    });
    const results = await runResearchSweep("markets", {
      globalVoices: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      mastodonQueries: [
        { hashtag: "Markets", instance: "mastodon.social" },
        { hashtag: "Markets", instance: "mastodon.online" },
        { hashtag: "Markets", instance: "mstdn.jp" },
        { hashtag: "Markets", instance: "mastodon.world" },
      ],
      mastodonTermsAccepted: true,
    }, fetcher, NOW);

    expect(requested.sort()).toEqual(["mastodon.online", "mastodon.social", "mastodon.world", "mstdn.jp"]);
    expect(results.map(({ key, status }) => [key, status])).toEqual([
      ["mastodon:mastodon.social", "complete"],
      ["mastodon:mastodon.online", "complete"],
      ["mastodon:mstdn.jp", "complete"],
      ["mastodon:mastodon.world", "complete"],
    ]);
  });

  it("runs at most three distinct Mastodon topic tags per instance as separately auditable views", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response("[]");
    });
    const results = await runResearchSweep("Nvidia earnings", {
      lemmy: false,
      mastodonQueries: [
        { hashtag: "Nvidia", instance: "mastodon.social" },
        { hashtag: "earnings", instance: "mastodon.social" },
      ],
    }, fetcher, NOW);
    expect(requested).toHaveLength(2);
    expect(results.map(({ key, label, query }) => [key, label, query])).toEqual([
      ["mastodon:mastodon.social:nvidia", "Mastodon · mastodon.social · #Nvidia", "#Nvidia"],
      ["mastodon:mastodon.social:earnings", "Mastodon · mastodon.social · #earnings", "#earnings"],
    ]);
  });

  it("queries local-only Mastodon records for focused servers without implying a national sample", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify([{
      id: "77", url: "https://town.voyager.blue/@reader/77", created_at: new Date(NOW - 60_000).toISOString(),
      visibility: "public", content: "<p>반도체 투자 전망 <a href=\"https://example.test/report\">기사</a></p>", language: "ko", account: {
        acct: "reader", url: "https://town.voyager.blue/@reader", bot: false,
      },
    }])));
    const [result] = await runResearchSweep("semiconductor", {
      globalVoices: false, lemmy: false, lemmyTermsAccepted: false,
      mastodonQueries: [{ hashtag: "반도체", instance: "town.voyager.blue" }],
      mastodonLocalInstances: ["town.voyager.blue"], mastodonTermsAccepted: true,
    }, fetcher, NOW);
    expect(result.label).toContain("local posts only");
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("local")).toBe("true");
    expect(result.window).toContain("Locally hosted public hashtag posts only");
    expect(result.evidence[0].context).toContain("does not verify poster nationality or residence");
    expect(result.evidence[0].context).toContain("restricted to statuses hosted on this server");
    expect(result.evidence[0].context).toContain("does not establish the author's independent view");
  });

  it("requires every focused Mastodon instance to have a selected query", async () => {
    const fetcher = vi.fn();
    await expect(runResearchSweep("topic", {
      globalVoices: false, lemmy: false, lemmyTermsAccepted: false,
      mastodonQueries: [{ hashtag: "topic", instance: "mastodon.social" }],
      mastodonLocalInstances: ["town.voyager.blue"], mastodonTermsAccepted: true,
    }, fetcher, NOW)).rejects.toThrow("must also have a selected hashtag search");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects repeated Mastodon tags and more than three tags on one server before fetching", async () => {
    const fetcher = vi.fn();
    const base = ["one", "two", "three", "four"].map((hashtag) => ({ hashtag, instance: "mastodon.social" }));
    await expect(runResearchSweep("topic", { lemmy: false, mastodonQueries: base.slice(0, 3) }, fetcher, NOW)).resolves.toHaveLength(3);
    await expect(runResearchSweep("topic", { lemmy: false, mastodonQueries: base }, fetcher, NOW)).rejects.toThrow("up to three distinct");
    await expect(runResearchSweep("topic", { lemmy: false, mastodonQueries: [base[0], { ...base[0], hashtag: "#ONE" }] }, fetcher, NOW)).rejects.toThrow("up to three distinct");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("searches selected providers in parallel and preserves provider-specific labels and classes", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.bsky.app") {
        return new Response(JSON.stringify({ posts: [{
          uri: "at://did:plc:reader/app.bsky.feed.post/one",
          record: { text: "A useful discussion https://example.test/story", createdAt: new Date(NOW - 60_000).toISOString(), langs: ["en"] },
          author: { handle: "reader.example" },
        }] }));
      }
      if (url.hostname === "api.stackexchange.com") {
        return new Response(JSON.stringify({ items: [{
          question_id: 12,
          title: "Question about markets",
          link: "https://economics.stackexchange.com/questions/12/example",
          creation_date: Math.floor((NOW - 60_000) / 1000),
          content_license: "CC BY-SA 4.0",
          owner: { display_name: "Reader", link: "https://economics.stackexchange.com/users/4/reader" },
        }] }));
      }
      if (url.hostname === "lemmy.world") {
        return new Response(JSON.stringify({ posts: [{
          post: {
            id: 13,
            ap_id: "https://lemmy.world/post/13",
            name: "A community discussion",
            body: "This post body is transiently previewed, never saved https://example.test/thread",
            published: new Date(NOW - 60_000).toISOString(),
            language_id: 37,
          },
          creator: { name: "Member", actor_id: "https://lemmy.world/u/member" },
          community: { name: "economy" },
        }] }));
      }
      if (url.hostname === "en.wikipedia.org") {
        return new Response(JSON.stringify({ query: { search: [{
          pageid: 14,
          title: "Talk:Markets",
          timestamp: new Date(NOW - 60_000).toISOString(),
          snippet: "Transient snippet is not retained",
        }] } }));
      }
      throw new Error("Unexpected provider");
    });
    const results = await runResearchSweep("markets", {
      bluesky: true,
      stackExchangeSite: "economics",
      lemmy: true,
      lemmyTermsAccepted: true,
      wikimediaLanguage: "en",
    }, fetcher, NOW);

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(results.map(({ key, evidence, error }) => [key, evidence.length, error])).toEqual([
      ["stack-exchange:economics", 1, null],
      ["lemmy:lemmy.world", 1, null],
      ["bluesky:0", 1, null],
      ["wikimedia", 1, null],
    ]);
    expect(results[0].evidence[0]).toMatchObject({
      evidenceClass: "expert Q&A",
      licenseName: "CC BY-SA 4.0",
    });
    expect(results[1].evidence[0]).toMatchObject({
      sourceOperatorKey: "lemmy-federation",
      sourceOperatorLabel: "Lemmy federated search",
    });
    expect(results[2].evidence[0]).toMatchObject({ source: "Bluesky public AppView · search 1 · query “markets”", transientPreview: "A useful discussion https://example.test/story" });
    expect(results[2].evidence[0].context).toContain("does not establish the author's independent view");
    expect(results[1].evidence[0].evidenceClass).toBe("social discussion");
    expect(results[1].evidence[0].transientPreview).toBe("This post body is transiently previewed, never saved https://example.test/thread");
    expect(results[1].evidence[0].context).toContain("does not establish the author's independent view");
    expect(results[1].evidence[0].context ?? "").not.toContain("markets");
    expect(results[2]).toMatchObject({ query: "markets", asOf: new Date(NOW).toISOString() });
    expect(results[3].evidence[0]).toMatchObject({
      evidenceClass: "editorial discussion",
      context: expect.stringContaining("not a general forum"),
    });
  });

  it("reports partial localized-edition coverage instead of hiding failed editions", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ editions: [
      { language: "en", edition: "English", articles: [{ id: "en:1", title: "Market update", url: "https://globalvoices.org/2026/09/29/market-update/", publishedAt: new Date(NOW - 60_000).toISOString() }], error: null },
      { language: "fr", edition: "French", articles: [], error: "Timed out" },
    ] }), { status: 200 }));
    const [result] = await runResearchSweep("market update", {
      globalVoices: true,
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW);
    expect(result).toMatchObject({
      query: "market update",
      asOf: new Date(NOW).toISOString(),
      coverageNote: expect.stringContaining("French"),
      window: expect.stringContaining("1/2 editions"),
      evidence: [expect.objectContaining({ title: "Market update", language: "en" })],
    });
    expect(result.error).toBeNull();
  });

  it("does not require an in-app terms affirmation to query a public Lemmy API", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ posts: [] })));
    const results = await runResearchSweep("markets", { gdelt: false, lemmy: true }, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ key: "lemmy:lemmy.world", status: "complete", evidence: [] });
  });

  it("keeps selected Lemmy instance results separate", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/site")
        ? Response.json({ all_languages: [{ id: 37, code: "en", name: "English" }] })
        : new Response(JSON.stringify({ posts: [{
        post: { id: 2, ap_id: `https://${url.hostname}/post/2`, name: "A recent topic", published: new Date(NOW - 60_000).toISOString(), language_id: 37 },
        creator: { name: "member", actor_id: `https://${url.hostname}/u/member` },
        community: { name: "world" },
      }] }));
    });
    const results = await runResearchSweep("markets", {
      gdelt: false,
      lemmy: true,
      lemmyInstances: ["lemmy.world", "discuss.tchncs.de"],
      lemmyTermsAccepted: true,
    }, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(results.map(({ key, evidence }) => [key, evidence[0]?.source])).toEqual([
      ["lemmy:lemmy.world", "Lemmy · lemmy.world / c/world"],
      ["lemmy:discuss.tchncs.de", "Lemmy · discuss.tchncs.de / c/world"],
    ]);
  });

  it("distinguishes locally hosted community results from the federated search view", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(new URL(String(input)));
      return new Response(JSON.stringify({ posts: [] }));
    });
    const results = await runResearchSweep("markets", {
      lemmy: true,
      lemmyInstances: ["lemmy.world", "jlai.lu"],
      lemmyLocalInstances: ["jlai.lu"],
    }, fetcher, NOW);
    expect(requested.filter((url) => url.pathname.endsWith("/search")).map((url) => [url.hostname, url.searchParams.get("listing_type")])).toEqual([
      ["lemmy.world", "All"],
      ["jlai.lu", "Local"],
    ]);
    expect(results.map(({ label }) => label)).toEqual([
      "Lemmy · lemmy.world · federated search",
      "Lemmy · jlai.lu · locally hosted communities",
    ]);
  });

  it("rejects local Lemmy views that were not selected for the search", async () => {
    await expect(runResearchSweep("markets", {
      lemmy: true,
      lemmyInstances: ["lemmy.world"],
      lemmyLocalInstances: ["jlai.lu"],
    }, vi.fn(), NOW)).rejects.toThrow("Local Lemmy views must be selected");
  });

  it("queries all six reviewed public instances independently within one bounded sweep", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ posts: [] })));
    const results = await runResearchSweep("markets", {
      lemmy: true,
      lemmyInstances: ["lemmy.world", "discuss.tchncs.de", "feddit.org", "jlai.lu", "sopuli.xyz", "sh.itjust.works"],
    }, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(results.map(({ key, status }) => [key, status])).toEqual([
      ["lemmy:lemmy.world", "complete"],
      ["lemmy:discuss.tchncs.de", "complete"],
      ["lemmy:feddit.org", "complete"],
      ["lemmy:jlai.lu", "complete"],
      ["lemmy:sopuli.xyz", "complete"],
      ["lemmy:sh.itjust.works", "complete"],
    ]);
  });

  it("uses a separately supplied local-language phrase for each Lemmy instance", async () => {
    const requested: Array<{ host: string; phrase: string | null }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push({ host: url.hostname, phrase: url.searchParams.get("q") });
      return new Response(JSON.stringify({ posts: [] }));
    });
    await runResearchSweep("semiconductor", {
      gdelt: false,
      lemmy: true,
      lemmyInstances: ["lemmy.world", "jlai.lu"],
      lemmyQueries: [
        { host: "lemmy.world", query: "semiconductor" },
        { host: "jlai.lu", query: "semi-conducteur" },
      ],
      lemmyTermsAccepted: true,
    }, fetcher, NOW);
    expect(requested.filter(({ phrase }) => phrase !== null)).toEqual([
      { host: "lemmy.world", phrase: "semiconductor" },
      { host: "jlai.lu", phrase: "semi-conducteur" },
    ]);
  });

  it("sends researcher-supplied localized phrases to separate Stack Exchange communities", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const site = url.searchParams.get("site");
      return new Response(JSON.stringify({ items: [{
        question_id: site === "es.stackoverflow" ? 101 : 202,
        title: site === "es.stackoverflow" ? "Inflación y tipos de interés" : "金利とインフレ",
        link: `https://${site}.com/questions/${site === "es.stackoverflow" ? 101 : 202}/example`,
        creation_date: Math.floor((NOW - 60_000) / 1000),
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Contributor", link: `https://${site}.com/users/1/contributor` },
      }] }));
    });
    const results = await runResearchSweep("inflation", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      stackExchangeQueries: [
        { site: "es.stackoverflow", query: "inflación tipos de interés" },
        { site: "ja.stackoverflow", query: "インフレ 金利" },
      ],
    }, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/search/advanced")).map(([url]) => new URL(String(url)).searchParams.get("title"))).toEqual([
      "inflación tipos de interés",
      "インフレ 金利",
    ]);
    expect(results.map(({ key, evidence }) => [key, evidence[0]?.language, evidence[0]?.context])).toEqual([
      ["stack-exchange:es.stackoverflow", "Spanish", expect.stringContaining("question title search")],
      ["stack-exchange:ja.stackoverflow", "Japanese", expect.stringContaining("question title search")],
    ]);
    expect(results.flatMap(({ evidence }) => evidence).map(({ context }) => context ?? "").join(" ")).not.toContain("inflación tipos de interés");
    expect(results.flatMap(({ evidence }) => evidence).map(({ context }) => context ?? "").join(" ")).not.toContain("インフレ 金利");
  });

  it("caps Stack Exchange cross-community requests at four", async () => {
    const fetcher = vi.fn();
    await expect(runResearchSweep("inflation", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      stackExchangeQueries: ["economics", "money", "ai", "security", "law"].map((site) => ({ site, query: "inflation" })),
    }, fetcher, NOW)).rejects.toThrow("no more than four");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects duplicate Stack Exchange communities before making a request", async () => {
    const fetcher = vi.fn();
    await expect(runResearchSweep("inflation", {
      gdelt: false,
      lemmy: false,
      lemmyTermsAccepted: false,
      stackExchangeQueries: [
        { site: "economics", query: "inflation" },
        { site: "economics", query: "price increases" },
      ],
    }, fetcher, NOW)).rejects.toThrow("only once");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps source failures separate so one rate-limited API does not erase other results", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.bsky.app") return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ query: { search: [] } }));
    });
    const results = await runResearchSweep("markets", {
      bluesky: true,
      lemmy: false,
      lemmyTermsAccepted: false,
      wikimediaLanguage: "en",
    }, fetcher, NOW);
    expect(results[0]).toMatchObject({ key: "bluesky:0", status: "unavailable" });
    expect(results[0].error).toMatch(/rate-limiting/);
    expect(results[1]).toMatchObject({ key: "wikimedia", error: null, evidence: [] });
  });
});
