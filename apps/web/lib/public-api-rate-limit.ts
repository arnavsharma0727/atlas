import "server-only";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared database limits; client IPs are HMACed and never persisted in clear text. */
export async function allowPublicGdeltRequest(
  request: NextRequest,
  db: SupabaseClient | null,
): Promise<"allowed" | "limited" | "unavailable"> {
  return consumePublicRequestLimit("gdelt", request, db);
}

/** Shared AI-provider limits across serverless instances; unknown infrastructure fails closed. */
export async function allowPublicMarketAssistRequest(
  request: NextRequest,
  db: SupabaseClient | null,
): Promise<"allowed" | "limited" | "unavailable"> {
  return consumePublicRequestLimit("market-assist", request, db);
}

async function consumePublicRequestLimit(
  route: "gdelt" | "market-assist",
  request: NextRequest,
  db: SupabaseClient | null,
): Promise<"allowed" | "limited" | "unavailable"> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Vercel overwrites this header at its edge, preventing a caller-supplied IP.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",", 1)[0]?.trim();
  if (!db || !secret || (!clientIp && process.env.NODE_ENV === "production")) return "unavailable";

  try {
    const clientHash = hmac(secret, `${route}:client:${clientIp || "local-development"}`);
    const globalHash = hmac(secret, `${route}:global`);
    const { data, error } = await db.rpc("consume_public_endpoint_rate_limit", {
      p_route_name: route,
      p_client_hash: clientHash,
      p_global_hash: globalHash,
    });
    if (error) return "unavailable";
    return data === true ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
