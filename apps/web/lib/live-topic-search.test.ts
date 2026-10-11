import { describe, expect, it, vi } from "vitest";
import { getStackExchangeThrottleStatus, resetStackExchangeThrottleStatus, searchLiveDiscussion } from "./live-topic-search";

describe("searchLiveDiscussion", () => {
  it("queries one selected community and returns only attributed CC BY-SA 4.0 items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [
        {
          question_id: 12,
          title: "How does inflation affect &#39;real&#39; rates?",
          link: "https://economics.stackexchange.com/questions/12/example",
          creation_date: 1790734268,
          content_license: "CC BY-SA 4.0",
          tags: ["inflation", "interest-rates"],
          owner: { display_name: "Researcher", link: "https://economics.stackexchange.com/users/1/researcher" },
        },
        {
          question_id: 13,
          title: "Unlicensed item",
          link: "https://economics.stackexchange.com/questions/13/example",
          creation_date: 1790734268,
          content_license: "CC BY-SA 2.5",
          owner: { display_name: "Contributor", link: "https://economics.stackexchange.com/users/2" },
        },
      ],
    }), { status: 200 }));

    const result = await searchLiveDiscussion("  inflation  ", "economics", fetchMock, Date.parse("2026-10-01T00:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.searchParams.get("site")).toBe("economics");
    expect(requestUrl.searchParams.get("title")).toBe("inflation");
    expect(requestUrl.searchParams.has("intitle")).toBe(false);
    expect(requestUrl.searchParams.get("origin")).toBe("*");
    expect(requestUrl.searchParams.get("pagesize")).toBe("25");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "How does inflation affect 'real' rates?",
      author: "Researcher",
      community: "Economics Stack Exchange",
      language: "English",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    });
  });

  it("rejects invalid queries and unlisted communities before making a request", async () => {
    const fetchMock = vi.fn();
    await expect(searchLiveDiscussion("ab", "economics", fetchMock)).rejects.toThrow("3–80 characters");
    await expect(searchLiveDiscussion("valid topic", "unknown", fetchMock)).rejects.toThrow("listed community");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors API-reported backoff and exposes its reported remaining quota", async () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], quota_remaining: 17, backoff: 5 }), { status: 200 }));
    try {
      await searchLiveDiscussion("inflation", "economics", fetchMock, now);
      expect(getStackExchangeThrottleStatus().quotaRemaining).toBe(17);
      await expect(searchLiveDiscussion("tariffs", "economics", fetchMock, now + 1_000)).rejects.toThrow("wait 4 seconds");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      resetStackExchangeThrottleStatus();
    }
  });

  it("supports a licensed policy discussion community", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        question_id: 42,
        title: "How do tariffs affect trade policy?",
        link: "https://politics.stackexchange.com/questions/42/example",
        creation_date: 1790734268,
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Contributor", link: "https://politics.stackexchange.com/users/1" },
      }],
    }), { status: 200 }));
    const result = await searchLiveDiscussion("tariffs", "politics", fetchMock, Date.parse("2026-10-01T00:00:00Z"));
    expect(result[0]).toMatchObject({
      community: "Politics Stack Exchange",
      language: "English",
      title: "How do tariffs affect trade policy?",
    });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("site")).toBe("politics");
  });

  it("returns a clear message when the source rate-limits requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    await expect(searchLiveDiscussion("inflation", "economics", fetchMock)).rejects.toThrow("rate-limiting");
  });

  it("filters partial matches, wrong-community links, stale records, and future-dated records locally", async () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const row = (id: number, title: string, createdAt: number, host = "economics.stackexchange.com") => ({
      question_id: id,
      title,
      link: `https://${host}/questions/${id}/example`,
      creation_date: Math.floor(createdAt / 1000),
      content_license: "CC BY-SA 4.0",
      owner: { display_name: "Contributor", link: `https://${host}/users/1` },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [
      row(1, "EV battery supply chain", now - 60_000),
      row(2, "EV charging infrastructure", now - 60_000),
      row(3, "Battery supply chain", now - 60_000),
      row(4, "EV battery supply chain", now - 31 * 24 * 60 * 60 * 1000),
      row(5, "EV battery supply chain", now + 60_000),
      row(6, "EV battery supply chain", now - 60_000, "example.com"),
    ] }), { status: 200 }));

    const result = await searchLiveDiscussion("EV battery", "economics", fetchMock, now);
    expect(result.map(({ id }) => id)).toEqual([1]);
  });

  it("preserves researcher-entered localized searches without applying English token rules", async () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{
      question_id: 8,
      title: "インフレと金利の関係",
      link: "https://ja.stackoverflow.com/questions/8/example",
      creation_date: Math.floor((now - 60_000) / 1000),
      content_license: "CC BY-SA 4.0",
      owner: { display_name: "Contributor", link: "https://ja.stackoverflow.com/users/1" },
    }] }), { status: 200 }));
    const result = await searchLiveDiscussion("インフレ 金利", "ja.stackoverflow", fetchMock, now);
    expect(result).toHaveLength(1);
    expect(result[0].language).toBe("Japanese");
  });

  it("enforces quoted exact phrases in titles", async () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [
      { question_id: 1, title: "Electric vehicle supply chain", link: "https://economics.stackexchange.com/questions/1/example", creation_date: Math.floor((now - 60_000) / 1000), content_license: "CC BY-SA 4.0", owner: { display_name: "Reader", link: "https://economics.stackexchange.com/users/1" } },
      { question_id: 2, title: "Electric buses and vehicle supply", link: "https://economics.stackexchange.com/questions/2/example", creation_date: Math.floor((now - 60_000) / 1000), content_license: "CC BY-SA 4.0", owner: { display_name: "Reader", link: "https://economics.stackexchange.com/users/1" } },
    ] }), { status: 200 }));
    const result = await searchLiveDiscussion('"electric vehicle"', "economics", fetchMock, now);
    expect(result.map(({ id }) => id)).toEqual([1]);
  });
});
