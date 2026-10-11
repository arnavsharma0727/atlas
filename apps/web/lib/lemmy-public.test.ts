import { afterEach, describe, expect, it, vi } from "vitest";
import { compareLemmyInstances, LemmyInstance, searchLemmyPosts } from "./lemmy-public";

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
      transientPreview: "Private-to-the-app body that should not be retained",
    }]);
    expect(posts[0].transientPreview).toContain("Private-to-the-app body");
    const requestUrl = new URL(fetchMock.mock.calls[0][0] as URL);
    expect(requestUrl.origin).toBe("https://lemmy.world");
    expect(requestUrl.searchParams.get("q")).toBe("central bank");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
  });

  it("filters removed, deleted, future, stale, and non-HTTPS records", async () => {
    const body = { posts: [
      item({ id: 43, removed: true }),
      item({ id: 47, nsfw: true }),
      item({ id: 48, bot: true }),
      item({ id: 44, published: "2026-09-20T00:00:00Z" }),
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
