import { describe, expect, it, vi } from "vitest";
import { withFetchTimeout } from "./fetch-with-timeout";

describe("withFetchTimeout", () => {
  it("aborts stalled provider requests with a readable timeout error", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));

    await expect(withFetchTimeout(fetcher, 5)("https://example.test"))
      .rejects.toThrow("Source request timed out after 1 seconds.");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("clears the timeout after a successful response", async () => {
    vi.useFakeTimers();
    try {
      const response = new Response("ok");
      const fetcher = vi.fn(async () => response);
      await expect(withFetchTimeout(fetcher, 500)("https://example.test")).resolves.toBe(response);
      await vi.advanceTimersByTimeAsync(600);
      expect(await response.text()).toBe("ok");
      expect(vi.getTimerCount()).toBe(0);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled body even when headers arrived immediately", async () => {
    const canceled = vi.fn();
    const response = new Response(new ReadableStream({ start() {}, cancel: canceled }));
    const fetcher = vi.fn(async () => response);
    await expect(withFetchTimeout(fetcher, 10)("https://example.test"))
      .rejects.toThrow("Source request timed out");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(canceled).toHaveBeenCalledOnce();
  });

  it("does not let a partial JSON body extend the request deadline", async () => {
    const response = new Response(new ReadableStream({ start(stream) {
      stream.enqueue(new TextEncoder().encode('{"items":['));
    } }));
    await expect(withFetchTimeout(async () => response, 10)("https://example.test"))
      .rejects.toThrow("Source request timed out");
  });

  it("rejects oversized bodies without returning a truncated success", async () => {
    const response = new Response("12345");
    await expect(withFetchTimeout(async () => response, 500, 4)("https://example.test"))
      .rejects.toThrow("bounded byte limit");
  });

  it("keeps redirect provenance, HTTP status, headers and full multibyte JSON intact", async () => {
    const response = new Response(JSON.stringify({ topic: "天然ガス" }), {
      status: 429, statusText: "Too Many Requests", headers: { "retry-after": "30", "content-type": "application/json" },
    });
    Object.defineProperties(response, { url: { value: "https://example.test/final" }, redirected: { value: true } });
    const result = await withFetchTimeout(async () => response)("https://example.test/start");
    expect(result).toBe(response);
    expect(result.url).toBe("https://example.test/final");
    expect(result.redirected).toBe(true);
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("30");
    expect(result.bodyUsed).toBe(false);
    expect(await result.json()).toEqual({ topic: "天然ガス" });
  });

  it("propagates caller cancellation during body consumption", async () => {
    const caller = new AbortController();
    const reason = new Error("Caller canceled");
    const response = new Response(new ReadableStream({ start() {} }));
    const request = withFetchTimeout(async () => response, 500)("https://example.test", { signal: caller.signal });
    const assertion = expect(request).rejects.toBe(reason);
    caller.abort(reason);
    await assertion;
  });

  it("honors a pre-aborted Request without invoking the source", async () => {
    const caller = new AbortController();
    caller.abort(new Error("Already canceled"));
    const fetcher = vi.fn(async () => new Response("unexpected"));
    await expect(withFetchTimeout(fetcher)(new Request("https://example.test", { signal: caller.signal })))
      .rejects.toThrow("Already canceled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps null-body responses valid", async () => {
    const response = new Response(null, { status: 204 });
    expect(await withFetchTimeout(async () => response)("https://example.test")).toBe(response);
  });

  it.each([0, -1, Infinity, NaN])("rejects invalid deadline %s", (deadline) => {
    expect(() => withFetchTimeout(fetch, deadline)).toThrow("positive finite");
  });
});
