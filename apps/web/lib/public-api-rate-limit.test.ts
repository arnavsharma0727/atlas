import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowPublicGdeltRequest, allowPublicMarketAssistRequest } from "./public-api-rate-limit";

vi.mock("server-only", () => ({}));

function request(ip: string | null) {
  return new NextRequest("https://atlas.test/api/research/market-assist", {
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
}

function database(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient;
}

describe("shared public API rate limits", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-private-hmac-secret");
  });

  it("uses route-scoped opaque hashes for the shared AI limit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const result = await allowPublicMarketAssistRequest(request("203.0.113.77"), database(rpc));
    expect(result).toBe("allowed");
    expect(rpc).toHaveBeenCalledWith("consume_public_endpoint_rate_limit", expect.objectContaining({
      p_route_name: "market-assist",
      p_client_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_global_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    const parameters = rpc.mock.calls[0][1];
    expect(parameters.p_client_hash).not.toContain("203.0.113.77");
    expect(parameters.p_global_hash).not.toBe(parameters.p_client_hash);
  });

  it("preserves the existing GDELT route name", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await allowPublicGdeltRequest(request("203.0.113.9"), database(rpc))).toBe("allowed");
    expect(rpc).toHaveBeenCalledWith("consume_public_endpoint_rate_limit", expect.objectContaining({ p_route_name: "gdelt" }));
  });

  it("distinguishes a shared quota denial from a database failure", async () => {
    const limitedRpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const failedRpc = vi.fn().mockResolvedValue({ data: null, error: new Error("private database detail") });
    expect(await allowPublicMarketAssistRequest(request("203.0.113.77"), database(limitedRpc))).toBe("limited");
    expect(await allowPublicMarketAssistRequest(request("203.0.113.77"), database(failedRpc))).toBe("unavailable");
  });

  it("fails closed in production if Supabase or its trusted client IP is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const rpc = vi.fn();
    expect(await allowPublicMarketAssistRequest(request("203.0.113.77"), null)).toBe("unavailable");
    expect(await allowPublicMarketAssistRequest(request(null), database(rpc))).toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
});
