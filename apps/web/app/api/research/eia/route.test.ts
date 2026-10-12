import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(query: string, ip = "192.0.2.141", contentType = "application/json") {
  return new NextRequest("https://atlas.example/api/research/eia", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: JSON.stringify({ query }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("EIA visitor-search route", () => {
  it("requires a configured private key and does not call EIA for missing key or irrelevant topics", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("EIA_API_KEY", "");
    expect((await POST(request("oil"))).status).toBe(400);
    expect((await POST(request("crude oil", "192.0.2.142", "text/plain"))).status).toBe(415);
    const irrelevant = await POST(request("semiconductor stocks", "192.0.2.143"));
    expect(irrelevant.status).toBe(400);
    const unconfigured = await POST(request("crude oil", "192.0.2.144"));
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toMatchObject({ code: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the API key server-side and returns only bounded public-domain evidence", async () => {
    vi.stubEnv("EIA_API_KEY", "private-test-key");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("api_key")).toBe("private-test-key");
      return Response.json({ response: { data: [
        { period: "2026-09-22", value: "96.41", series: "RWTC", "value-units": "$/BBL" },
        { period: "2026-09-22", value: "100.20", series: "RBRTE", "value-units": "$/BBL" },
      ] } });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request("crude oil", "192.0.2.145"));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain("private-test-key");
    expect(JSON.parse(text)).toMatchObject({ evidence: [
      { id: "eia:RWTC:2026-09-22", evidenceClass: "official statistical data" },
      { id: "eia:RBRTE:2026-09-22", evidenceClass: "official statistical data" },
    ] });
  });
});
