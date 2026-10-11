import { describe, expect, it, vi } from "vitest";
import { runResearchSweep } from "./research-sweep";

const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("runResearchSweep", () => {
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

  it("flags a Bluesky sample dominated by one displayed handle", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ posts: [
      { uri: "at://did:plc:abc/app.bsky.feed.post/a", record: { text: "First distinct view", createdAt: new Date(NOW - 1000).toISOString() }, author: { handle: "one.example" } },
      { uri: "at://did:plc:abc/app.bsky.feed.post/b", record: { text: "Second distinct view", createdAt: new Date(NOW - 2000).toISOString() }, author: { handle: "one.example" } },
      { uri: "at://did:plc:abc/app.bsky.feed.post/c", record: { text: "Third distinct view", createdAt: new Date(NOW - 3000).toISOString() }, author: { handle: "one.example" } },
    ] })));
    const [result] = await runResearchSweep("markets", {
      hackerNews: false,
      globalVoices: false,
      bluesky: true,
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW);
    expect(result.sourceNote).toContain("one displayed handle appears in 3 of 3");
  });

  it("rejects duplicate and excessive alternate phrases before any provider call", async () => {
    const fetcher = vi.fn();
    await expect(runResearchSweep("topic", {
      hackerNews: true,
      additionalQueries: [" TOPIC "],
      lemmy: false,
      lemmyTermsAccepted: false,
    }, fetcher, NOW)).rejects.toThrow("must be different");
    await expect(runResearchSweep("topic", {
      hackerNews: true,
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

  it("searches each approved Mastodon instance separately and preserves source identity", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(new URL(String(input)).hostname);
      return new Response("[]");
    });
    const results = await runResearchSweep("markets", {
      hackerNews: false,
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

  it("searches selected providers in parallel and preserves provider-specific labels and classes", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.bsky.app") {
        return new Response(JSON.stringify({ posts: [{
          uri: "at://did:plc:reader/app.bsky.feed.post/one",
          record: { text: "A useful discussion", createdAt: new Date(NOW - 60_000).toISOString(), langs: ["en"] },
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
            body: "This post body is transiently previewed, never saved",
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

    expect(fetcher).toHaveBeenCalledTimes(4);
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
    expect(results[2].evidence[0]).toMatchObject({ source: "Bluesky public AppView · search 1", transientPreview: "A useful discussion" });
    expect(results[1].evidence[0].evidenceClass).toBe("social discussion");
    expect(results[1].evidence[0].transientPreview).toBe("This post body is transiently previewed, never saved");
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
      hackerNews: false,
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
    expect(fetcher).toHaveBeenCalledOnce();
    expect(results[0]).toMatchObject({ key: "lemmy:lemmy.world", status: "complete", evidence: [] });
  });

  it("keeps selected Lemmy instance results separate", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify({ posts: [{
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results.map(({ key, evidence }) => [key, evidence[0]?.source])).toEqual([
      ["lemmy:lemmy.world", "Lemmy · lemmy.world / c/world"],
      ["lemmy:discuss.tchncs.de", "Lemmy · discuss.tchncs.de / c/world"],
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
    expect(requested).toEqual([
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("title"))).toEqual([
      "inflación tipos de interés",
      "インフレ 金利",
    ]);
    expect(results.map(({ key, evidence }) => [key, evidence[0]?.language, evidence[0]?.context])).toEqual([
      ["stack-exchange:es.stackoverflow", "Spanish", expect.stringContaining("title-only query")],
      ["stack-exchange:ja.stackoverflow", "Japanese", expect.stringContaining("title-only query")],
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
