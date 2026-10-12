import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const xml = '<Envelope><Cube><Cube time="2026-10-09"><Cube currency="USD" rate="1.12"/><Cube currency="KRW" rate="1500"/></Cube></Cube></Envelope>';
function request(body: unknown, type = "application/json") {
  return new NextRequest("https://atlas.example/api/research/ecb", { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
describe("ECB bounded public proxy", () => {
  it("validates topic/country/body before any upstream request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    expect((await POST(request({ query: "GPU prices", country: "US" }))).status).toBe(400);
    expect((await POST(request({ query: "currency", country: "__proto__" }))).status).toBe(400);
    expect((await POST(request({ query: "currency", country: "US" }, "text/plain"))).status).toBe(415);
    expect((await POST(request({ query: "x".repeat(3000), country: "US" }))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("coalesces lenses and retains original provider fetch time on cache hits", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    const fetcher = vi.fn(async () => new Response(xml));
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    const responses = await Promise.all([POST(request({ query: "currency", country: "KR" })), POST(request({ query: "USD currency", country: "US" }))]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const first = await responses[0].json();
    expect(first.evidence).toHaveLength(2);
    vi.advanceTimersByTime(60000);
    const next = await POST(request({ query: "exchange rates", country: "DE" }));
    expect(next.status).toBe(200);
    expect(next.headers.get("cache-control")).toBe("no-store");
    expect((await next.json()).fetchedAt).toBe(first.fetchedAt);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("backs off failed upstream access rather than hammering the free provider", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    expect((await POST(request({ query: "currency", country: "KR" }))).status).toBe(503);
    expect((await POST(request({ query: "currency", country: "US" }))).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
