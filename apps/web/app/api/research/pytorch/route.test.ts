import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const request = (query: unknown, ip = "192.0.2.1", type = "application/json") => new NextRequest("https://atlas.example/api/research/pytorch", {
  method: "POST", headers: { "content-type": type, "x-forwarded-for": ip }, body: JSON.stringify({ query }),
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const empty = () => Response.json({ topic_list: { topics: [] } });

describe("PyTorch server bridge", () => {
  it("rejects invalid/out-of-scope input before accessing the provider", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    for (const query of ["x", "inflation", 42, "gpu".repeat(100)]) expect((await POST(request(query))).status).toBe(400);
    expect((await POST(request("gpu", "192.0.2.1", "text/plain"))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shares one cached feed across different technical queries and returns no-store provenance", async () => {
    const fetcher = vi.fn(async (_input: unknown) => empty()); vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    const responses = await Promise.all([POST(request("GPU")), POST(request("CUDA", "192.0.2.2"))]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body.sample.feedCount).toBe(0);
      expect(Number.isFinite(Date.parse(body.sample.retrievedAt))).toBe(true);
    }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://discuss.pytorch.org/latest.json");
  });
  it("limits repeated visitors without multiplying provider reads", async () => {
    const fetcher = vi.fn(async () => empty()); vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    for (let n = 0; n < 3; n++) expect((await POST(request("GPU"))).status).toBe(200);
    const response = await POST(request("GPU"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("backs off a failed feed instead of converting it to an empty successful result", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 429 })); vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    expect((await POST(request("GPU"))).status).toBe(503);
    expect((await POST(request("CUDA", "192.0.2.2"))).status).toBe(503);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("caps new upstream reads across visitors, reporting skipped topic reads as partial rather than absent", async () => {
    const date = new Date(Date.now() - 86400000).toISOString();
    const topics = Array.from({ length: 12 }, (_, n) => ({ id: n + 1, title: `GPU tag${n}`, created_at: date, visible: true, archetype: "regular" }));
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("latest.json")) return Response.json({ topic_list: { topics } });
      const id = Number(url.match(/\/t\/(\d+)\.json$/u)?.[1]);
      return Response.json({ ...topics[id - 1], post_stream: { posts: [{ topic_id: id, post_number: 1, post_type: 1, hidden: false, deleted_at: null, created_at: date, username: "Fixture", cooked: "<p>GPU deployment is limited by memory constraints on this server.</p>" }] } });
    });
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("./route");
    let last: { sample: { failedTopics: number } } | undefined;
    for (let n = 0; n < 12; n++) {
      const response = await POST(request(`GPU tag${n}`, `192.0.2.${n + 10}`));
      expect(response.status).toBe(200);
      last = await response.json();
    }
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(last?.sample.failedTopics).toBe(1);
  });
});
