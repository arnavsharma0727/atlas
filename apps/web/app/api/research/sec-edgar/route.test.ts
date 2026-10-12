import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown, ip = "192.0.2.91", contentType = "application/json") {
  return new NextRequest("https://atlas.example/api/research/sec-edgar", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("SEC EDGAR visitor-search route", () => {
  it("validates input, requires configured contact identity, and returns no-store metadata", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("SEC_USER_AGENT", "");
    expect((await POST(request({ query: "A" }))).status).toBe(400);
    expect((await POST(request({ query: "AAPL" }, "192.0.2.92", "text/plain"))).status).toBe(415);
    expect((await POST(request({ query: "AAPL" }, "192.0.2.93"))).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();

    vi.stubEnv("SEC_USER_AGENT", "Atlas Research (atlas-test@example.test)");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }), { status: 200 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ name: "Apple Inc.", filings: { recent: {
      form: ["10-K"], accessionNumber: ["0000320193-26-000001"], filingDate: ["2026-08-01"], primaryDocument: ["aapl-10k.htm"],
    } } }), { status: 200 }));
    const response = await POST(request({ query: "AAPL" }, "192.0.2.94"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ issuer: { ticker: "AAPL" }, filings: [{ form: "10-K" }] });
  });

  it("returns an upstream outage as unavailable and enforces the request ceiling", async () => {
    vi.stubEnv("SEC_USER_AGENT", "Atlas Research (atlas-test@example.test)");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    expect((await POST(request({ query: "TSLA" }, "192.0.2.95"))).status).toBe(503);
    await POST(request({ query: "TSLA" }, "192.0.2.96"));
    await POST(request({ query: "TSLA" }, "192.0.2.96"));
    const limited = await POST(request({ query: "TSLA" }, "192.0.2.96"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});
