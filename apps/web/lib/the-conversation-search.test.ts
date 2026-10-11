import { describe, expect, it, vi } from "vitest";
import { THE_CONVERSATION_EDITIONS } from "./connectors/the-conversation";
import { searchTheConversation } from "./the-conversation-search";

const NOW = Date.parse("2026-10-11T12:00:00Z");

function entry(input: { title?: string; link?: string; published?: string; rights?: string; summary?: string } = {}) {
  return `<entry><id>tag:theconversation.com,2026:story</id><title>${input.title ?? "Semiconductor demand outlook"}</title><link rel="alternate" href="${input.link ?? "https://theconversation.com/au/example-story"}"/><published>${input.published ?? "2026-10-10T10:00:00Z"}</published><rights>${input.rights ?? "Licensed as Creative Commons – attribution, no derivatives."}</rights><author><name>Research Author</name></author><summary>${input.summary ?? "Feed summary is transient and must not be returned"}</summary></entry>`;
}

function feed(entries: string) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>tag:theconversation.com,feed</id><title>The Conversation</title>${entries}</feed>`;
}

describe("The Conversation on-demand headline search", () => {
  it("searches all six first-party feeds and returns only recent licensed title metadata", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(feed(entry()), { status: 200 });
    });
    const results = await searchTheConversation("semiconductor", fetcher, NOW);
    expect(results).toHaveLength(6);
    expect(results.every(({ articles }) => articles.length === 1 && articles[0].title === "Semiconductor demand outlook")).toBe(true);
    expect(results[0].articles[0]).toMatchObject({
      url: "https://theconversation.com/au/example-story",
      authors: ["Research Author"],
      publishedAt: "2026-10-10T10:00:00.000Z",
    });
    expect(JSON.stringify(results)).not.toContain("Feed summary");
    expect(requested.sort()).toEqual(THE_CONVERSATION_EDITIONS.map(({ feed: url }) => url).sort());
  });

  it("requires every meaningful headline term, a recent date, a first-party URL, and feed reuse rights", async () => {
    const fetcher = vi.fn(async () => new Response(feed([
      entry({ title: "Semiconductor demand outlook", rights: "All rights reserved." }),
      entry({ title: "Semiconductor demand outlook", published: "2026-08-01T10:00:00Z" }),
      entry({ title: "Semiconductor demand outlook", link: "https://example.org/story" }),
      entry({ title: "General market update" }),
    ].join("")), { status: 200 }));
    const results = await searchTheConversation("semiconductor demand", fetcher, NOW);
    expect(results.every(({ articles }) => articles.length === 0)).toBe(true);
  });

  it("keeps each feed's failure separate while returning the successful edition", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/us/")
      ? new Response("unavailable", { status: 503 })
      : new Response(feed(entry()), { status: 200 }));
    const results = await searchTheConversation("semiconductor", fetcher, NOW);
    expect(results.find(({ code }) => code === "us")).toMatchObject({ error: "Feed unavailable", articles: [] });
    expect(results.find(({ code }) => code === "au")).toMatchObject({ error: null, articles: [{ title: "Semiconductor demand outlook" }] });
  });

  it("rejects oversized feed bodies before parsing them", async () => {
    const fetcher = vi.fn(async () => new Response("small", { status: 200, headers: { "content-length": "1500001" } }));
    const results = await searchTheConversation("semiconductor", fetcher, NOW);
    expect(results.every(({ error }) => error === "Feed exceeded the response-size limit")).toBe(true);
  });

  it("rejects malformed query lengths before making feed requests", async () => {
    const fetcher = vi.fn();
    await expect(searchTheConversation("x", fetcher, NOW)).rejects.toThrow("2–100 characters");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
