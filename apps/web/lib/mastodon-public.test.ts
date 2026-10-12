import { describe, expect, it, vi } from "vitest";
import {
  comparePublicHashtag,
  compareTrendingHashtags,
  fetchTrendingHashtags,
  mastodonHtmlToTransientText,
  searchPublicHashtag,
} from "./mastodon-public";

const post = {
  id: "123",
  url: "https://other.instance/@person/123",
  created_at: "2026-09-30T21:00:00.000Z",
  visibility: "public",
  content: "<p>Public discussion text</p>",
  spoiler_text: "",
  language: "en",
  account: {
    display_name: "Researcher",
    acct: "person@other.instance",
    url: "https://other.instance/@person",
    bot: false,
  },
};

describe("searchPublicHashtag", () => {
  it("encodes Hindi combining marks without changing the requested hashtag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([post]));
    const results = await searchPublicHashtag("महंगाई", fetchMock, Date.parse("2026-10-01T00:00:00Z"));
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(url.pathname)).toBe("/api/v1/timelines/tag/महंगाई");
    expect(results).toHaveLength(1);
  });
  it.each([null, {}, { error: "schema changed" }])("does not treat malformed timeline payloads as a successful empty search: %j", async (body) => {
    await expect(searchPublicHashtag("semiconductor", vi.fn(async () => Response.json(body)))).rejects.toThrow("unrecognized timeline response");
  });

  it("refuses an oversized timeline even if the provider ignores the requested limit", async () => {
    await expect(searchPublicHashtag("semiconductor", vi.fn(async () => Response.json(Array(21).fill(post))))).rejects.toThrow("exceeded the bounded timeline");
  });

  it("skips null records without losing valid timeline records", async () => {
    const rows = await searchPublicHashtag("semiconductor", vi.fn(async () => Response.json([null, post])), Date.parse("2026-10-01T00:00:00Z"));
    expect(rows).toHaveLength(1);
  });

  it("queries one encoded hashtag and keeps only public, non-boost posts with provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      post,
      { ...post, id: "private", visibility: "unlisted" },
      { ...post, id: "boost", reblog: post },
      { ...post, id: "unsafe", url: "javascript:alert(1)" },
    ]), { status: 200 }));

    const results = await searchPublicHashtag("#public-conversation", fetchMock, Date.parse("2026-10-01T00:00:00Z"), "mstdn.jp");
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url.hostname).toBe("mstdn.jp");
    expect(url.pathname).toBe("/api/v1/timelines/tag/public-conversation");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      url: post.url,
      authorName: "Researcher",
      authorHandle: "person@other.instance",
      authorUrl: post.account.url,
      originServer: "other.instance",
      language: "en",
      contentHtml: post.content,
      accountMarkedAutomated: false,
    });
  });

  it("drops Mastodon items older than the 30-day freshness window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      post,
      { ...post, id: "stale", created_at: "2026-08-30T00:00:00.000Z" },
    ]), { status: 200 }));
    const results = await searchPublicHashtag("markets", fetchMock, Date.parse("2026-10-01T00:00:00Z"));
    expect(results.map(({ id }) => id)).toEqual(["123"]);
  });

  it("rejects invalid hashtags without making a request", async () => {
    const fetchMock = vi.fn();
    await expect(searchPublicHashtag("bad/tag", fetchMock)).rejects.toThrow("1–50 letters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary server names before making a request", async () => {
    const fetchMock = vi.fn();
    await expect(searchPublicHashtag("economics", fetchMock, Date.now(), "attacker.example" as never))
      .rejects.toThrow("Choose a supported public Mastodon server");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permits the reviewed Brazilian Portuguese instance through the bounded public endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { ...post, url: "https://organica.social/@reader/123", language: "pt", created_at: "2026-10-10T00:00:00.000Z" },
    ]), { status: 200 }));
    const results = await searchPublicHashtag("ibovespa", fetchMock, Date.parse("2026-10-11T00:00:00Z"), "organica.social");
    expect(new URL(fetchMock.mock.calls[0][0]).hostname).toBe("organica.social");
    expect(results).toHaveLength(1);
    expect(results[0].language).toBe("pt");
  });

  it("requests the instance-local subset only when explicitly asked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    await searchPublicHashtag("markets", fetchMock, Date.now(), "town.voyager.blue", true);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("local")).toBe("true");

    const defaultFetch = vi.fn().mockResolvedValue(Response.json([]));
    await searchPublicHashtag("markets", defaultFetch, Date.now(), "mastodon.social");
    expect(new URL(defaultFetch.mock.calls[0][0]).searchParams.has("local")).toBe(false);
  });

  it("does not try to authenticate when public access is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(searchPublicHashtag("economics", fetchMock)).rejects.toThrow("No login or workaround");
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
  });
});

describe("mastodonHtmlToTransientText", () => {
  it("converts provider HTML to escaped-renderable plain text and caps long content", () => {
    expect(mastodonHtmlToTransientText('<p>Rates &amp; markets</p><p>Second &#x1F4AC; line</p>'))
      .toBe("Rates & markets\nSecond 💬 line");
    expect(mastodonHtmlToTransientText('<p>before</p><script>alert(1)</script><p>after</p>'))
      .toBe("before\nafter");
    expect(mastodonHtmlToTransientText(`<p>${"x".repeat(1400)}</p>`)).toHaveLength(1200);
  });
});

describe("comparePublicHashtag", () => {
  it("deduplicates overlapping server views but preserves per-server sample counts", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([post]), { status: 200 })),
    );
    const result = await comparePublicHashtag("markets", fetchMock, Date.parse("2026-10-01T00:00:00Z"), [
      "mastodon.social", "mstdn.jp",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.views).toEqual([
      { host: "mastodon.social", tag: "markets", returnedCount: 1, error: null },
      { host: "mstdn.jp", tag: "markets", returnedCount: 1, error: null },
    ]);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].seenVia).toEqual(["mastodon.social", "mstdn.jp"]);
    expect(result.samples[0].searches).toEqual([
      { host: "mastodon.social", tag: "markets" },
      { host: "mstdn.jp", tag: "markets" },
    ]);
  });

  it("keeps successful samples when one server view fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      String(url).includes("mstdn.jp")
        ? Promise.resolve(new Response("", { status: 429 }))
        : Promise.resolve(new Response(JSON.stringify([post]), { status: 200 })),
    );
    const result = await comparePublicHashtag("markets", fetchMock, Date.parse("2026-10-01T00:00:00Z"), [
      "mastodon.social", "mstdn.jp",
    ]);
    expect(result.views[0].error).toBeNull();
    expect(result.views[1].error).toContain("rate-limiting");
    expect(result.samples).toHaveLength(1);
  });

  it("sends a distinct visitor-supplied hashtag to each selected server", async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      requested.push(String(url));
      return Promise.resolve(new Response(JSON.stringify([post]), { status: 200 }));
    });
    const result = await comparePublicHashtag([
      { host: "mastodon.social", tag: "AI" },
      { host: "mstdn.jp", tag: "人工知能" },
    ], fetchMock, Date.parse("2026-10-01T00:00:00Z"), ["mastodon.social", "mstdn.jp"]);
    expect(requested).toEqual([
      "https://mastodon.social/api/v1/timelines/tag/AI?limit=20",
      "https://mstdn.jp/api/v1/timelines/tag/%E4%BA%BA%E5%B7%A5%E7%9F%A5%E8%83%BD?limit=20",
    ]);
    expect(result.views.map(({ host, tag }) => [host, tag])).toEqual([
      ["mastodon.social", "AI"],
      ["mstdn.jp", "人工知能"],
    ]);
    expect(result.samples[0].searches).toEqual([
      { host: "mastodon.social", tag: "AI" },
      { host: "mstdn.jp", tag: "人工知能" },
    ]);
  });

  it("rejects missing or duplicate server queries before network access", async () => {
    const fetchMock = vi.fn();
    await expect(comparePublicHashtag([
      { host: "mastodon.social", tag: "AI" },
    ], fetchMock, Date.now(), ["mastodon.social", "mstdn.jp"])).rejects.toThrow("exactly one");
    await expect(comparePublicHashtag([
      { host: "mastodon.social", tag: "AI" },
      { host: "mastodon.social", tag: "markets" },
    ], fetchMock, Date.now(), ["mastodon.social"])).rejects.toThrow("only once");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("public Mastodon trending tags", () => {
  it("requests one public list, keeps simple Unicode hashtags, and constructs a same-server link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { name: "economics" },
      { name: "半導体" },
      { name: "invalid tag" },
      { name: "x".repeat(51) },
    ]), { status: 200 }));
    const tags = await fetchTrendingHashtags("mstdn.jp", fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://mstdn.jp/api/v1/trends/tags?limit=10");
    expect(tags).toEqual([
      { name: "economics", url: "https://mstdn.jp/tags/economics" },
      { name: "半導体", url: "https://mstdn.jp/tags/%E5%8D%8A%E5%B0%8E%E4%BD%93" },
    ]);
  });

  it("does not authenticate or retry when an instance limits public access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    await expect(fetchTrendingHashtags("mastodon.social", fetchMock)).rejects.toThrow("No login or workaround");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
  });

  it("keeps each instance trend list separate and reports per-instance errors", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).includes("mstdn.jp")
        ? new Response("", { status: 429 })
        : new Response(JSON.stringify([{ name: "economics" }]), { status: 200 })),
    );
    const result = await compareTrendingHashtags(fetchMock, ["mastodon.social", "mstdn.jp"]);
    expect(result).toMatchObject([
      { host: "mastodon.social", tags: [{ name: "economics" }], error: null },
      { host: "mstdn.jp", tags: [], error: "This instance is rate-limiting requests. Try again later." },
    ]);
  });
});
