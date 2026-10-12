import { afterEach, describe, expect, it, vi } from "vitest";
import { compareLemmyInstances, getLemmyLanguageCatalog, LemmyInstance, searchLemmyPosts, searchLemmyPostPage } from "./lemmy-public";

afterEach(() => vi.unstubAllGlobals());

const now = Date.parse("2026-09-30T12:00:00Z");
function item(overrides: { id?: number; ap_id?: string; published?: string; removed?: boolean; nsfw?: boolean; bot?: boolean } = {}) {
  return {
      post: {
        id: overrides.id ?? 42,
        ap_id: overrides.ap_id ?? "https://lemmy.world/post/42",
        name: "Central bank discussion",
        body: "Private-to-the-app body that should not be retained",
        published: overrides.published ?? "2026-09-30T10:00:00Z",
        removed: overrides.removed ?? false,
        nsfw: overrides.nsfw ?? false,
        language_id: 37,
      },
      creator: { name: "reader", actor_id: "https://lemmy.world/u/reader", bot_account: overrides.bot ?? false },
      community: { name: "economy" },
  };
}

describe("Lemmy public discussion search", () => {
  it("resolves instance-specific post language IDs from that instance's public site metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      all_languages: [
        { id: 32, code: "de", name: "Deutsch" },
        { id: 37, code: "en", name: "English" },
      ],
    }), { status: 200 }));
    const catalog = await getLemmyLanguageCatalog("discuss.tchncs.de", fetchMock);
    expect(new URL(fetchMock.mock.calls[0][0] as string).href).toBe("https://discuss.tchncs.de/api/v3/site");
    expect(catalog?.get(32)).toEqual({ code: "de", name: "Deutsch" });
    expect(catalog?.get(37)?.code).toBe("en");
    expect(catalog?.get(84)).toBeUndefined();
  });

  it("fails open when language metadata is unavailable or malformed", async () => {
    const unavailable = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    expect(await getLemmyLanguageCatalog("jlai.lu", unavailable)).toBeNull();
    const malformed = vi.fn().mockResolvedValue(new Response(JSON.stringify({ all_languages: [{ id: 1, code: "not a code", name: "bad" }] }), { status: 200 }));
    expect(await getLemmyLanguageCatalog("jlai.lu", malformed)).toBeNull();
    await expect(getLemmyLanguageCatalog("unknown.invalid" as LemmyInstance, malformed)).rejects.toThrow("supported public Lemmy");
  });

  it("returns only recent, linked metadata and never includes post bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ posts: [item()] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const posts = await searchLemmyPosts("central bank", "lemmy.world", fetch, now);
    expect(posts).toEqual([{
      id: "42",
      url: "https://lemmy.world/post/42",
      title: "Central bank discussion",
      publishedAt: "2026-09-30T10:00:00.000Z",
      author: "reader",
      authorUrl: "https://lemmy.world/u/reader",
      community: "economy",
      languageId: 37,
      linkedContent: false,
      transientPreview: "Private-to-the-app body that should not be retained",
    }]);
    expect(posts[0].transientPreview).toContain("Private-to-the-app body");
    const requestUrl = new URL(fetchMock.mock.calls[0][0] as URL);
    expect(requestUrl.origin).toBe("https://lemmy.world");
    expect(requestUrl.searchParams.get("q")).toBe("central bank");
    expect(requestUrl.searchParams.get("limit")).toBe("50");
    expect(requestUrl.searchParams.get("listing_type")).toBe("All");
  });

  it("can query only communities hosted on the selected server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ posts: [item()] }), { status: 200 }));
    const posts = await searchLemmyPosts("central bank", "lemmy.world", fetchMock, now, "local");
    expect(posts).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls[0][0] as URL).searchParams.get("listing_type")).toBe("Local");
  });

  it("detects an API attachment independently of the post text without retaining its URL", async () => {
    const post = item();
    const fetcher = vi.fn(async () => Response.json({ posts: [{ ...post, post: { ...post.post, url: "https://publisher.example/report" } }] }));
    const page = await searchLemmyPostPage("central bank", "lemmy.world", fetcher, now);
    expect(page.posts[0].linkedContent).toBe(true);
    expect(JSON.stringify(page)).not.toContain("publisher.example");
  });

  it("preserves raw counts separately from stale and removed items", async () => {
    const fetcher = vi.fn(async () => Response.json({ posts: [item(), item({ id: 43, removed: true }), item({ id: 44, published: "2026-08-20T00:00:00Z" })] }));
    const page = await searchLemmyPostPage("central bank", "lemmy.world", fetcher, now);
    expect(page).toMatchObject({ returnedCount: 3, excludedCount: 2 });
    expect(page.posts).toHaveLength(1);
  });

  it("excludes malformed records without silently treating malformed attachments as original text", async () => {
    const normal = item();
    const fetcher = vi.fn(async () => Response.json({ posts: [
      normal, null,
      { ...normal, post: { ...normal.post, url: { unsafe: "unknown attachment" } } },
      { ...normal, post: { ...normal.post, id: -1 } },
      { ...normal, post: { ...normal.post, published: now } },
    ] }));
    const page = await searchLemmyPostPage("central bank", "lemmy.world", fetcher, now);
    expect(page).toMatchObject({ returnedCount: 5, excludedCount: 4 });
    expect(page.posts).toHaveLength(1);
  });

  it.each([{}, null, { posts: null }, { posts: {} }])("does not interpret a malformed API response as no discussion: %j", async (body) => {
    const fetcher = vi.fn(async () => Response.json(body));
    await expect(searchLemmyPosts("central bank", "lemmy.world", fetcher, now)).rejects.toThrow("unrecognized post-search");
  });

  it("refuses responses larger than the requested bound", async () => {
    const fetcher = vi.fn(async () => Response.json({ posts: Array.from({ length: 51 }, (_, index) => item({ id: index + 1 })) }));
    await expect(searchLemmyPosts("central bank", "lemmy.world", fetcher, now)).rejects.toThrow("exceeded the bounded");
  });

  it("filters removed, deleted, future, stale, and non-HTTPS records", async () => {
    const body = { posts: [
      item({ id: 43, removed: true }),
      item({ id: 47, nsfw: true }),
      item({ id: 48, bot: true }),
      item({ id: 44, published: "2026-08-20T00:00:00Z" }),
      item({ id: 45, ap_id: "javascript:alert(1)" }),
      item({ id: 46, published: "2026-10-01T00:00:00Z" }),
      item(),
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    expect(await searchLemmyPosts("central bank", "lemmy.world", fetch, now)).toHaveLength(1);
  });

  it("keeps only the instance whose terms were reviewed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ posts: [item()] }), { status: 200 }));
    const views = await compareLemmyInstances("central bank", fetchMock, now, ["lemmy.world"]);
    expect(views.map(({ host, returnedCount, error }) => ({ host, returnedCount, error }))).toEqual([
      { host: "lemmy.world", returnedCount: 1, error: null },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(compareLemmyInstances("central bank", fetchMock, now, ["lemmy.ml" as unknown as LemmyInstance]))
      .rejects.toThrow("supported public Lemmy instances");
  });

  it("queries a selected second instance as a separate bounded view", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("discuss.tchncs.de");
      expect(url.pathname).toBe("/api/v3/search");
      return Promise.resolve(new Response(JSON.stringify({ posts: [item({ ap_id: "https://discuss.tchncs.de/post/42" })] }), { status: 200 }));
    });
    const views = await compareLemmyInstances("semiconductor", fetchMock, now, ["discuss.tchncs.de"]);
    expect(views).toMatchObject([{ host: "discuss.tchncs.de", returnedCount: 1, error: null }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["feddit.org", "sopuli.xyz", "sh.itjust.works"] as const)("queries the public API for %s and returns only a capped transient body preview", async (host) => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(`https://${host}`);
      expect(url.pathname).toBe("/api/v3/search");
      return Promise.resolve(new Response(JSON.stringify({ posts: [item({ ap_id: `https://${host}/post/42` })] }), { status: 200 }));
    });
    const posts = await searchLemmyPosts("semiconductor", host, fetchMock, now);
    expect(posts).toHaveLength(1);
    expect(posts[0].transientPreview).toContain("Private-to-the-app body");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a distinct visitor-supplied phrase to each instance and preserves it per view", async () => {
    const requests: URL[] = [];
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      requests.push(new URL(String(input)));
      return Promise.resolve(new Response(JSON.stringify({ posts: [] }), { status: 200 }));
    });
    const views = await compareLemmyInstances([
      { host: "lemmy.world", query: "central bank" },
      { host: "discuss.tchncs.de", query: "banque centrale" },
    ], fetchMock, now, ["lemmy.world", "discuss.tchncs.de"]);
    expect(requests.map((url) => [url.hostname, url.searchParams.get("q")])).toEqual([
      ["lemmy.world", "central bank"],
      ["discuss.tchncs.de", "banque centrale"],
    ]);
    expect(views.map(({ host, query }) => [host, query])).toEqual([
      ["lemmy.world", "central bank"],
      ["discuss.tchncs.de", "banque centrale"],
    ]);
  });

  it("rejects missing, duplicate, or malformed per-instance phrases before network calls", async () => {
    const fetchMock = vi.fn();
    await expect(compareLemmyInstances([
      { host: "lemmy.world", query: "central bank" },
    ], fetchMock, now, ["lemmy.world", "discuss.tchncs.de"])).rejects.toThrow("exactly one");
    await expect(compareLemmyInstances([
      { host: "lemmy.world", query: "central bank" },
      { host: "lemmy.world", query: "interest rates" },
    ], fetchMock, now, ["lemmy.world"])).rejects.toThrow("only once");
    await expect(compareLemmyInstances([
      { host: "lemmy.world", query: "x" },
    ], fetchMock, now, ["lemmy.world"])).rejects.toThrow("2–100 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates query length", async () => {
    await expect(searchLemmyPosts("a", "lemmy.world")).rejects.toThrow("2–100 characters");
  });
});
