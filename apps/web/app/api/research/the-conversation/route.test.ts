import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown, ip = "192.0.2.41") {
  return new NextRequest("https://atlas.example/api/research/the-conversation", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function feed() {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>tag:theconversation.com,feed</id><title>The Conversation</title><entry><id>tag:theconversation.com,story</id><title>Semiconductor demand outlook</title><link rel="alternate" href="https://theconversation.com/au/example"/><published>${new Date().toISOString()}</published><rights>Licensed as Creative Commons – attribution, no derivatives.</rights><author><name>Research Author</name></author><summary>Do not return this feed excerpt.</summary></entry></feed>`;
}

describe("The Conversation visitor search route", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("validates the query before any provider request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ query: "x" }));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses only fixed publisher feeds and returns no-store licensed headline metadata", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).hostname).toBe("theconversation.com");
      return new Response(feed(), { status: 200, headers: { "content-type": "application/atom+xml" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ query: "semiconductor" }, "192.0.2.42"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledTimes(6);
    const result = await response.json();
    expect(result.editions).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain("Do not return this feed excerpt");
  });
});
