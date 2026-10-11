import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown, ip = "192.0.2.71", contentType = "application/json") {
  return new NextRequest("https://atlas.example/api/research/crossref", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Crossref visitor-search route", () => {
  it("validates input and responds no-store", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(request({ query: "x" }))).status).toBe(400);
    expect((await POST(request({ query: "stocks" }, "192.0.2.72", "text/plain"))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();

    const provider = vi.fn(async () => new Response(JSON.stringify({ message: { items: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", provider);
    const response = await POST(request({ query: "crossref-cache-test-topic" }, "192.0.2.74"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ works: [] });
    const repeated = await POST(request({ query: "crossref-cache-test-topic" }, "192.0.2.75"));
    expect(repeated.status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
  });

  it("enforces a per-client in-memory request ceiling", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })));
    const ip = "192.0.2.73";
    await POST(request({ query: "semiconductor" }, ip));
    await POST(request({ query: "semiconductor" }, ip));
    await POST(request({ query: "semiconductor" }, ip));
    const response = await POST(request({ query: "semiconductor" }, ip));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("serializes distinct upstream searches within a server instance", async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
    }));
    const [first, second] = await Promise.all([
      POST(request({ query: "crossref-serial-alpha" }, "192.0.2.76")),
      POST(request({ query: "crossref-serial-beta" }, "192.0.2.77")),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(maxActive).toBe(1);
  });
});
