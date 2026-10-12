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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.searchParams.get("site")).toBe("economics");
    expect(requestUrl.searchParams.get("title")).toBe("inflation");
    expect(requestUrl.searchParams.has("intitle")).toBe(false);
    expect(requestUrl.searchParams.get("origin")).toBe("*");
    expect(requestUrl.searchParams.get("pagesize")).toBe("25");
    const answersUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(answersUrl.pathname).toBe("/2.3/questions/12/answers");
    expect(answersUrl.searchParams.get("filter")).toBe("withbody");
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

  it("records backoff from a non-OK search response before the next request", async () => {
    const now = Date.now();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_id: 502, backoff: 5 }), { status: 429 }));
    try {
      await expect(searchLiveDiscussion("inflation", "economics", fetchMock, now)).rejects.toThrow("rate-limiting");
      await expect(searchLiveDiscussion("tariffs", "economics", fetchMock, now + 1_000)).rejects.toThrow("wait 4 seconds");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getStackExchangeThrottleStatus().searchBackoffSeconds).toBeGreaterThan(0);
    } finally {
      resetStackExchangeThrottleStatus();
    }
  });

  it("does not present a successful HTTP response with an API error payload as an empty search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_id: 502, error_message: "throttle_violation" }), { status: 200 }));
    await expect(searchLiveDiscussion("inflation", "economics", fetchMock)).rejects.toThrow("returned an API error");
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

  it("returns recent licensed answer excerpts with separate author and direct-post attribution", async () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        question_id: 7,
        title: "Inflation and interest rates in bond markets",
        link: "https://economics.stackexchange.com/questions/7/example",
        creation_date: Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000),
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Question Author", link: "https://economics.stackexchange.com/users/1/question-author" },
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [
        {
          answer_id: 91,
          question_id: 7,
          link: "https://economics.stackexchange.com/a/91",
          body: "<p>Inflation expectations can lift nominal bond yields when investors expect tighter monetary policy.</p><script>alert(1)</script>",
          creation_date: Math.floor((now - 24 * 60 * 60 * 1000) / 1000),
          content_license: "CC BY-SA 4.0",
          owner: { display_name: "Answer Author", link: "https://economics.stackexchange.com/users/2/answer-author" },
        },
        {
          answer_id: 92,
          question_id: 7,
          link: "https://economics.stackexchange.com/a/92",
          body: "Unlicensed inflation answer with enough words to otherwise qualify for this response.",
          creation_date: Math.floor((now - 24 * 60 * 60 * 1000) / 1000),
          content_license: "CC BY-SA 3.0",
          owner: { display_name: "Other Author", link: "https://economics.stackexchange.com/users/3" },
        },
        {
          answer_id: 93,
          question_id: 7,
          link: "https://evil.example/a/93",
          body: "Inflation expectations can lift bond yields according to this answer, with enough words to qualify.",
          creation_date: Math.floor((now - 24 * 60 * 60 * 1000) / 1000),
          content_license: "CC BY-SA 4.0",
          owner: { display_name: "Bad Link", link: "https://economics.stackexchange.com/users/4" },
        },
      ] }), { status: 200 }));

    const result = await searchLiveDiscussion("inflation", "economics", fetchMock, now);
    expect(result[0]).toMatchObject({
      answerExcerpt: "Inflation expectations can lift nominal bond yields when investors expect tighter monetary policy.",
      answerUrl: "https://economics.stackexchange.com/a/91",
      answerAuthor: "Answer Author",
      answerAuthorUrl: "https://economics.stackexchange.com/users/2/answer-author",
    });
    expect(result[0].answerExcerpt).not.toContain("alert");
  });

  it("preserves title results when the licensed-answer endpoint is unavailable", async () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        question_id: 8,
        title: "Inflation and interest rates",
        link: "https://economics.stackexchange.com/questions/8/example",
        creation_date: Math.floor((now - 60_000) / 1000),
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Question Author", link: "https://economics.stackexchange.com/users/1" },
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const result = await searchLiveDiscussion("inflation", "economics", fetchMock, now);
    expect(result).toHaveLength(1);
    expect(result[0].answerLookupIssue).toContain("answer lookup was unavailable");
  });

  it("honors answer-endpoint backoff while retaining the successful title result", async () => {
    const now = Date.now();
    const question = {
      question_id: 8,
      title: "Inflation and interest rates",
      link: "https://economics.stackexchange.com/questions/8/example",
      creation_date: Math.floor((now - 60_000) / 1000),
      content_license: "CC BY-SA 4.0",
      owner: { display_name: "Question Author", link: "https://economics.stackexchange.com/users/1" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [question] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error_id: 502, backoff: 4 }), { status: 200 }));
    try {
      const result = await searchLiveDiscussion("inflation", "economics", fetchMock, now);
      expect(result[0].answerLookupIssue).toContain("answer lookup was unavailable");
      expect(getStackExchangeThrottleStatus().backoffSeconds).toBe(4);
    } finally {
      resetStackExchangeThrottleStatus();
    }
  });

  it("keeps title search available when only the answer endpoint is backing off", async () => {
    const now = Date.now();
    const row = (id: number, title: string) => ({
      question_id: id,
      title,
      link: `https://economics.stackexchange.com/questions/${id}/example`,
      creation_date: Math.floor((now - 60_000) / 1000),
      content_license: "CC BY-SA 4.0",
      owner: { display_name: "Question Author", link: "https://economics.stackexchange.com/users/1" },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [row(8, "Inflation and interest rates")] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], backoff: 4 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [row(9, "Tariffs and trade policy")] }), { status: 200 }));
    try {
      await searchLiveDiscussion("inflation", "economics", fetchMock, now);
      const result = await searchLiveDiscussion("tariffs", "economics", fetchMock, now + 1_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result[0].title).toBe("Tariffs and trade policy");
      expect(result[0].answerLookupIssue).toContain("answer-endpoint backoff");
      expect(getStackExchangeThrottleStatus().answersBackoffSeconds).toBeGreaterThan(0);
      expect(getStackExchangeThrottleStatus().searchBackoffSeconds).toBe(0);
    } finally {
      resetStackExchangeThrottleStatus();
    }
  });

  it("does not spend another API call when the title response exhausts shared quota", async () => {
    const now = Date.now();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      quota_remaining: 0,
      items: [{
        question_id: 8,
        title: "Inflation and interest rates",
        link: "https://economics.stackexchange.com/questions/8/example",
        creation_date: Math.floor((now - 60_000) / 1000),
        content_license: "CC BY-SA 4.0",
        owner: { display_name: "Question Author", link: "https://economics.stackexchange.com/users/1" },
      }],
    }), { status: 200 }));
    try {
      const result = await searchLiveDiscussion("inflation", "economics", fetchMock, now);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result[0].answerLookupIssue).toContain("no shared API quota remaining");
    } finally {
      resetStackExchangeThrottleStatus();
    }
  });
});
