import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("retired SEC bridge", () => {
  it.each(["", "Atlas (operator@example.test)"])("never fetches, including with configured identity: %s", async (identity) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("SEC_USER_AGENT", identity);
    const response = await POST();
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
