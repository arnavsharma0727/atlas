import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { allowPublicMarketAssistRequest } from "../../../lib/public-api-rate-limit";

vi.mock("../../../lib/server-supabase", () => ({ serverSupabase: () => null }));
vi.mock("../../../lib/public-api-rate-limit", () => ({ allowPublicMarketAssistRequest: vi.fn() }));

function request(body: unknown = { topic: "semiconductors", country: "DE" }) {
  return new NextRequest("https://atlas.example/api/compare", { method: "POST",
    headers: { "content-type": "application/json", host: "atlas.example", origin: "https://atlas.example" },
    body: JSON.stringify(body) });
}

const result = { sources: [
  { id: "S1", title: "U.S. chip demand report", url: "https://example.org/chips", scope: "US", excerpt: "U.S. chip demand is rising with larger data center orders.", publishedAt: "2026-10-10" },
  { id: "S2", title: "German chip demand report", url: "https://example.de/chips", scope: "selected", excerpt: "German chip demand is weak as industrial orders slow.", publishedAt: "2026-10-10" },
], comparison: { us: [{ text: "The U.S. report describes rising chip demand.", sourceIds: ["S1"] }],
  selected: [{ text: "The German report describes weak industrial demand.", sourceIds: ["S2"] }],
  differences: [{ text: "The reports point in different directions for chip demand.", sourceIds: ["S1", "S2"] }],
  gaps: ["Neither report establishes company margins."] } };

describe("one-call Groq comparison route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    vi.stubEnv("GROQ_API_KEY", "test-key"); vi.stubEnv("GROQ_FREE_TIER_ENABLED", "true");
    vi.mocked(allowPublicMarketAssistRequest).mockReset().mockResolvedValue("allowed");
  });
  it("requires browser search and serves only a citation-valid comparison", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(result);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: "openai/gpt-oss-120b", tools: [{ type: "browser_search" }], tool_choice: "required" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).response_format).toBeUndefined();
  });
  it("falls back once to the separate free model on a quota error", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "org_private provider message" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).model).toBe("openai/gpt-oss-20b");
  });
  it("does not expose provider diagnostics when both free models are limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "org_private provider message" } }, { status: 429 })));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(JSON.stringify(await response.json())).not.toContain("org_private");
  });
  it("withholds a comparison containing invented citation IDs", async () => {
    const invalid = { ...result, comparison: { ...result.comparison,
      us: [{ text: "An invented source says demand is strong.", sourceIds: ["S99"] }] } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] })));
    const response = await POST(request());
    const payload = await response.json();
    expect(payload.comparison).toBeNull();
    expect(payload.sources).toHaveLength(2);
  });
  it("makes no model call when disabled, limited, or input is null", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "false");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "true");
    vi.mocked(allowPublicMarketAssistRequest).mockResolvedValue("limited");
    expect((await POST(request())).status).toBe(429);
    expect((await POST(request(null))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
