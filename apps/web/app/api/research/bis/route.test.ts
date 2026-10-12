import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown, ip = "192.0.2.210", contentType = "application/json") {
  return new NextRequest("https://atlas.example/api/research/bis", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function csv(area: string) {
  return [
    "FREQ,EER_TYPE,EER_BASKET,REF_AREA,UNIT_MEASURE,TIME_FORMAT,COLLECTION,TITLE_TS,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK",
    "M,N,B," + area + ",882,,A,Country - Nominal - Broad,2025-08,100,A,F,",
    "M,N,B," + area + ",882,,A,Country - Nominal - Broad,2026-08,105,A,F,",
    "M,R,B," + area + ",882,,A,Country - Real - Broad,2025-08,100,A,F,",
    "M,R,B," + area + ",882,,A,Country - Real - Broad,2026-08,102,A,F,",
  ].join("\n");
}

afterEach(() => vi.unstubAllGlobals());

describe("BIS visitor-search route", () => {
  it("fails closed for irrelevant topics, invalid country choices, and non-JSON requests", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(request({ query: "semiconductor demand", country: "KR" }))).status).toBe(400);
    expect((await POST(request({ query: "USD FX", country: "XX" }, "192.0.2.211"))).status).toBe(400);
    expect((await POST(request({ query: "USD FX", country: "KR" }, "192.0.2.212", "text/plain"))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not send the visitor's query upstream and returns bounded attributed context", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.has("query")).toBe(false);
      expect(url.searchParams.has("country")).toBe(false);
      expect(url.searchParams.get("format")).toBe("csvfile");
      const area = url.pathname.endsWith(".US/all") ? "US" : "KR";
      return new Response(csv(area), { status: 200, headers: { "content-type": "text/csv" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ query: "USD currency", country: "KR" }, "192.0.2.213"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(body.evidence).toHaveLength(4);
    expect(body.evidence[0]).toMatchObject({
      id: "bis-eer:US:N:2026-08",
      evidenceClass: "official statistical data",
      sourceOperatorKey: "bis-statistics",
      licenseUrl: "https://data.bis.org/help/legal",
    });
    expect(body).toHaveProperty("retrievedAt");
  });
});
