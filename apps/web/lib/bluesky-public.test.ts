import { describe, expect, it, vi } from "vitest";
import { searchBlueskyPosts } from "./bluesky-public";

const NOW = Date.parse("2026-10-02T12:00:00Z");

describe("searchBlueskyPosts", () => {
  it("uses the official language parameter independently of a full-length phrase", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ posts: [] }));
    const query = "x".repeat(100);
    await searchBlueskyPosts(query, fetcher, NOW, { language: "en" });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe(query);
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("sort")).toBe("latest");
    expect(url.searchParams.get("limit")).toBe("25");
    await expect(searchBlueskyPosts("GPU", fetcher, NOW, { language: "en&author=other" })).rejects.toThrow("language filter");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("uses public search and returns an ephemeral preview with an attributed citation", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ posts: [{
      uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
      record: { text: "private transient body", createdAt: new Date(NOW - 1000).toISOString(), langs: ["en"] },
      author: { handle: "reader.example" },
    }] })));
    const results = await searchBlueskyPosts("markets", fetcher, NOW);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe("https://api.bsky.app");
    expect(url.searchParams.get("q")).toBe("markets");
    expect(results).toEqual([{
      uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
      url: "https://bsky.app/profile/reader.example/post/xyz",
      title: "Public Bluesky post by @reader.example",
      authorHandle: "reader.example",
      publishedAt: new Date(NOW - 1000).toISOString(),
      language: "en",
      transientPreview: "private transient body",
      duplicateCount: 1,
      linkedContent: false,
    }]);
    expect(JSON.stringify(results)).toContain("private transient body");
  });

  it("excludes stale and malformed records and rejects oversized queries", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ posts: [
      { uri: "at://did:plc:abc/app.bsky.feed.post/stale", record: { text: "old", createdAt: new Date(NOW - 8 * 86400000).toISOString() }, author: { handle: "a.example" } },
      { uri: "https://invalid", record: { text: "bad" }, author: { handle: "a.example" } },
    ] })));
    expect(await searchBlueskyPosts("markets", fetcher, NOW)).toEqual([]);
    await expect(searchBlueskyPosts("x".repeat(101), fetcher, NOW)).rejects.toThrow("2–100");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("withholds post text when Bluesky returns content labels", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ posts: [{
      uri: "at://did:plc:abc/app.bsky.feed.post/labeled",
      record: { text: "sensitive transient body", createdAt: new Date(NOW - 1000).toISOString() },
      author: { handle: "reader.example" },
      labels: [{ val: "sexual" }],
    }] })));
    const [result] = await searchBlueskyPosts("markets", fetcher, NOW);
    expect(result.transientPreview).toBeUndefined();
    expect(result.contentWarning).toContain("Preview withheld");
    expect(JSON.stringify(result)).not.toContain("sensitive transient body");
  });

  it("collapses exact repeated post text and discloses the duplicate count", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ posts: [
      { uri: "at://did:plc:abc/app.bsky.feed.post/first", record: { text: "Same copied post", createdAt: new Date(NOW - 1000).toISOString() }, author: { handle: "one.example" } },
      { uri: "at://did:plc:abc/app.bsky.feed.post/copy", record: { text: " same   copied POST ", createdAt: new Date(NOW - 2000).toISOString() }, author: { handle: "two.example" } },
      { uri: "at://did:plc:abc/app.bsky.feed.post/different", record: { text: "Different evidence", createdAt: new Date(NOW - 3000).toISOString() }, author: { handle: "three.example" } },
    ] })));
    const results = await searchBlueskyPosts("markets", fetcher, NOW);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ authorHandle: "one.example", duplicateCount: 2 });
  });

  it.each([
    { embed: { $type: "app.bsky.embed.external#view", external: { uri: "https://publisher.example/report" } } },
    { embed: { $type: "app.bsky.embed.external#viewArticle", uri: "https://publisher.example/report" } },
    { recordEmbed: { $type: "app.bsky.embed.external", external: { uri: "https://publisher.example/report" } } },
    { embed: { $type: "app.bsky.embed.recordWithMedia#view", media: { $type: "app.bsky.embed.external#view", external: { uri: "https://publisher.example/report" } } } },
    { embed: { $type: "app.bsky.embed.recordWithMedia#view", media: { $type: "app.bsky.embed.external#viewGallery", uri: "https://publisher.example/report" } } },
    { facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://publisher.example/report" }] }] },
  ])("detects external cards and rich-text link facets without retaining their destinations: %j", async (metadata) => {
    const fetcher = vi.fn(async () => Response.json({ posts: [{
      uri: "at://did:plc:abc/app.bsky.feed.post/card",
      author: { handle: "reader.example" }, embed: metadata.embed,
      record: { text: "Semiconductor demand is rising. Read more.", createdAt: new Date(NOW - 1000).toISOString(), embed: metadata.recordEmbed, facets: metadata.facets },
    }] }));
    const [post] = await searchBlueskyPosts("semiconductor", fetcher, NOW);
    expect(post.linkedContent).toBe(true);
    expect(JSON.stringify(post)).not.toContain("publisher.example");
  });

  it("does not mistake native images or mention/tag facets for external links", async () => {
    const fetcher = vi.fn(async () => Response.json({ posts: [{
      uri: "at://did:plc:abc/app.bsky.feed.post/image", author: { handle: "reader.example" },
      embed: { $type: "app.bsky.embed.images#view", images: [] },
      record: { text: "Semiconductor demand is rising.", createdAt: new Date(NOW - 1000).toISOString(), facets: [{ features: [{ $type: "app.bsky.richtext.facet#tag", tag: "semiconductor" }] }] },
    }] }));
    expect((await searchBlueskyPosts("semiconductor", fetcher, NOW))[0].linkedContent).toBe(false);
  });

  it("propagates link provenance across exact-text duplicates", async () => {
    const make = (id: string, embed?: object) => ({ uri: `at://did:plc:abc/app.bsky.feed.post/${id}`, author: { handle: "reader.example" }, embed, record: { text: "Semiconductor demand is rising.", createdAt: new Date(NOW - 1000).toISOString() } });
    const fetcher = vi.fn(async () => Response.json({ posts: [make("plain"), make("linked", { $type: "app.bsky.embed.external#view" })] }));
    const [post] = await searchBlueskyPosts("semiconductor", fetcher, NOW);
    expect(post).toMatchObject({ duplicateCount: 2, linkedContent: true });
  });

  it.each([null, {}, { posts: null }, { posts: {} }])("does not count a malformed response as an empty successful search: %j", async (body) => {
    await expect(searchBlueskyPosts("semiconductor", vi.fn(async () => Response.json(body)), NOW)).rejects.toThrow("unrecognized search response");
  });

  it("refuses responses larger than the requested limit", async () => {
    await expect(searchBlueskyPosts("semiconductor", vi.fn(async () => Response.json({ posts: Array(26).fill({}) })), NOW)).rejects.toThrow("exceeded the bounded search");
  });
});
