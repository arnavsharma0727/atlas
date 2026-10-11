import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/research/market-assist", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("free-tier market assist", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "false");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
    vi.unstubAllGlobals();
  });

  it("does not call an AI provider unless explicitly enabled server-side", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await POST(makeRequest({ action: "summarize", topic: "semiconductors", country: "KR", aiEnabled: true, evidence: { us: [], local: [] } }));
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires an explicit AI request from the search workflow", async () => {
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "true");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await POST(makeRequest({ action: "prepare", topic: "semiconductors", country: "KR", aiEnabled: false }));
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns an AI summary from source excerpts without exposing source URLs", async () => {
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "true");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      const messages = JSON.parse(String(init?.body)).messages as Array<{ role: string; content: string }>;
      const requestBody = JSON.parse(String(init?.body)) as { reasoning_effort?: string; max_completion_tokens?: number };
      expect(requestBody).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 1400 });
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("When excerpts explicitly disagree, describe both positions");
      expect(messages[0].content).toContain("do not invent counterevidence");
      const prompt = messages.find(({ role }) => role === "user")?.content ?? "";
      expect(prompt).toContain("semiconductors");
      expect(prompt).not.toContain("https://private.example");
      expect(prompt).not.toContain("@reader");
      expect(prompt).not.toContain("analyst@private.example");
      expect(prompt).toContain("[handle]");
      expect(prompt).toContain("[email]");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ usSummary: "US sample notes demand.", usCitations: ["C1"], localSummary: "KR sample notes exports.", localCitations: ["C2"], comparison: "Samples differ; evidence is limited.", comparisonCitations: ["C1", "C2"], limitations: ["Not representative"] }) } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const response = await POST(makeRequest({
      action: "summarize", topic: "semiconductors", country: "KR", aiEnabled: true,
      evidence: { us: [{ citationId: "C1", source: "Bluesky", title: "Public discussion post", excerpt: "Demand comments (@reader), https://private.example/story analyst@private.example", language: "en" }], local: [{ citationId: "C2", source: "Lemmy", title: "Public discussion post", excerpt: "Export comments", language: "ko" }] },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "ai", summary: { usSummary: { text: "US sample notes demand.", citations: ["C1"] }, localSummary: { text: "KR sample notes exports.", citations: ["C2"] }, comparison: { citations: ["C1", "C2"] } } });
  });

  it("retries Groq JSON validation failures once and still validates Atlas citations", async () => {
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "true");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "json_validate_failed", type: "invalid_request_error" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: `Here is the evidence summary:\n\n\`\`\`json\n${JSON.stringify({
        usSummary: "US sample notes demand.", usCitations: ["C1"], localSummary: "KR sample notes exports.", localCitations: ["C2"],
        comparison: "Samples differ; evidence is limited.", comparisonCitations: ["C1", "C2"], limitations: [],
      })}\n\`\`\`` } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(makeRequest({
      action: "summarize", topic: "semiconductors", country: "KR", aiEnabled: true,
      evidence: { us: [{ citationId: "C1", source: "Bluesky", title: "Post", excerpt: "Demand comments", language: "en" }], local: [{ citationId: "C2", source: "Lemmy", title: "Post", excerpt: "Export comments", language: "ko" }] },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "ai", summary: { usSummary: { citations: ["C1"] }, localSummary: { citations: ["C2"] } } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toHaveProperty("response_format");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).not.toHaveProperty("response_format");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 1400 });
  });

  it("rejects model passages with citations that were not included in the request", async () => {
    vi.stubEnv("GROQ_FREE_TIER_ENABLED", "true");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      usSummary: "Unsupported statement.", usCitations: ["C99"], localSummary: "No local evidence.", localCitations: [],
      comparison: "No comparison.", comparisonCitations: [], limitations: [],
    }) } }] }), { status: 200 })));
    const response = await POST(makeRequest({
      action: "summarize", topic: "semiconductors", country: "KR", aiEnabled: true,
      evidence: { us: [{ citationId: "C1", source: "Bluesky", title: "Post", excerpt: "Text", language: "en" }], local: [] },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ mode: "unavailable" });
  });
});
