import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown, ip = "192.0.2.81", contentType = "application/json") {
  return new NextRequest("https://atlas.example/api/research/arxiv", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("arXiv visitor-search route", () => {
  it("validates before calling the provider, returns no-store, and caches identical searches", async () => {
    const provider = vi.fn(async () => new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>`, { status: 200 }));
    vi.stubGlobal("fetch", provider);
    expect((await POST(request({ query: "x" }))).status).toBe(400);
    expect((await POST(request({ query: "paper" }, "192.0.2.82", "text/plain"))).status).toBe(415);
    expect(provider).not.toHaveBeenCalled();

    const response = await POST(request({ query: "arxiv-route-cache-topic" }, "192.0.2.83"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ records: [] });
    const cached = await POST(request({ query: "arxiv-route-cache-topic" }, "192.0.2.84"));
    expect(cached.status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
  });

  it("enforces a per-client in-memory request ceiling", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>`, { status: 200 })));
    const ip = "192.0.2.85";
    await POST(request({ query: "arxiv-limit-test-topic" }, ip));
    await POST(request({ query: "arxiv-limit-test-topic" }, ip));
    await POST(request({ query: "arxiv-limit-test-topic" }, ip));
    const response = await POST(request({ query: "arxiv-limit-test-topic" }, ip));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
