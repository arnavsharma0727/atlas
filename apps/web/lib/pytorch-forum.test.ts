import { describe, expect, it, vi } from "vitest";
import { pytorchAppliesToQuery, pytorchProse, searchPytorchForum } from "./pytorch-forum";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const DATE = "2026-10-05T13:34:11.684Z";
const topic = (id = 1, extra = {}) => ({ id, title: "GPU deployment pitfalls", created_at: DATE, visible: true, archetype: "regular", ...extra });
const post = (extra = {}) => ({ topic_id: 1, post_number: 1, post_type: 1, hidden: false, deleted_at: null, created_at: DATE, username: "Public_author", cooked: "<p>Our GPU deployment has memory limitations when running these models at full size.</p>", ...extra });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function mock(topics = [topic()], posts = [post()], detailExtra = {}) {
  return vi.fn(async (url: unknown) => String(url).endsWith("/latest.json")
    ? response({ topic_list: { topics } })
    : response({ ...topic(), post_stream: { posts }, ...detailExtra }));
}

describe("bounded PyTorch original-prose source", () => {
  it("limits activation to explicit technical interests", () => {
    expect(pytorchAppliesToQuery("NVIDIA GPU")).toBe(true);
    for (const query of ["oil", "inflation", "AI", "pytorchish", "半導体"]) expect(pytorchAppliesToQuery(query)).toBe(false);
  });
  it("retains attributed prose but makes no language/geography or AI eligibility claim", async () => {
    const fetcher = mock();
    const result = await searchPytorchForum("GPU", fetcher as typeof fetch, NOW);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ language: "Not reported", attribution: "Public_author", summaryEligible: false, sourceOperatorKey: "pytorch", timeValue: DATE, url: "https://discuss.pytorch.org/t/1/1" });
    expect(result.evidence[0].licenseName).toContain("CC BY 4.0");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["https://discuss.pytorch.org/latest.json", "https://discuss.pytorch.org/t/1.json"]);
  });
  it("never searches or paginates; caps feed at 30 and matching topic reads at three", async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/latest.json")) return response({ topic_list: { topics: Array.from({ length: 40 }, (_, n) => topic(n + 1)) } });
      const id = Number(String(url).match(/\/t\/(\d+)\.json$/u)?.[1]);
      return response({ ...topic(id), post_stream: { posts: [post({ topic_id: id })] } });
    });
    const result = await searchPytorchForum("GPU", fetcher as typeof fetch, NOW);
    expect(result.feedCount).toBe(30);
    expect(result.matchingTopics).toBe(30);
    expect(result.evidence).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not revive old bumped topics or accept substring, hidden, future or malformed titles", async () => {
    const fetcher = mock([
      topic(1, { created_at: "2024-01-01T00:00:00Z", last_posted_at: DATE }),
      topic(2, { title: "GPUs deployment" }), topic(3, { visible: false }),
      topic(4, { created_at: "2026-10-13T00:00:00Z" }), topic(5, { created_at: "2026-09-31T00:00:00Z" }),
      topic(6, { id: "6" }),
    ]);
    expect((await searchPytorchForum("GPU", fetcher as typeof fetch, NOW)).evidence).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    { hidden: true }, { deleted_at: DATE }, { post_type: 2 }, { post_number: 2 },
    { topic_id: 99 }, { username: "../../private" }, { created_at: "2025-01-01T00:00:00Z" },
    { cooked: "<pre>code only</pre>" }, { cooked: "<p>All rights reserved. This sufficiently long prose cannot be republished here.</p>" },
  ])("rejects unsafe or ineligible first posts: %j", async (extra) => {
    const result = await searchPytorchForum("GPU", mock([topic()], [post(extra)]) as typeof fetch, NOW);
    expect(result.evidence).toEqual([]);
    expect(result.excludedTopics).toBe(1);
  });
  it("rejects changed/private/deleted topic detail", async () => {
    for (const extra of [{ title: "unrelated" }, { archetype: "private_message" }, { visible: false }, { deleted_at: DATE }]) {
      expect((await searchPytorchForum("GPU", mock([topic()], [post()], extra) as typeof fetch, NOW)).evidence).toEqual([]);
    }
  });
  it("reports failed topic reads separately from successful empty results", async () => {
    const fetcher = vi.fn(async (url: unknown) => String(url).endsWith("latest.json") ? response({ topic_list: { topics: [topic()] } }) : new Response("", { status: 429 }));
    expect(await searchPytorchForum("GPU", fetcher as typeof fetch, NOW)).toMatchObject({ evidence: [], failedTopics: 1, excludedTopics: 0, matchingTopics: 1 });
    await expect(searchPytorchForum("GPU", vi.fn(async () => new Response("", { status: 429 })) as typeof fetch, NOW)).rejects.toThrow("rate-limited");
  });
  it("rejects malformed feed responses instead of inventing zero coverage", async () => {
    for (const payload of [{}, { topic_list: { topics: null } }, []]) await expect(searchPytorchForum("GPU", vi.fn(async () => response(payload)) as typeof fetch, NOW)).rejects.toThrow();
  });
  it("removes code, quotes, linked previews and unsafe markup without rendering HTML", () => {
    const html = '<p>Original &amp; prose.</p><pre>secret code</pre><code>artifact</code><blockquote>third-party quote</blockquote><aside>preview</aside><a href="https://other.example">copied title</a><script>unsafe</script><p>Next thought.</p>';
    expect(pytorchProse(html)).toBe("Original & prose. Next thought.");
    expect(pytorchProse("x".repeat(65_537))).toBe("");
    expect(pytorchProse("x".repeat(1000))).toHaveLength(900);
  });
});
