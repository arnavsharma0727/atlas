import { NextRequest, NextResponse } from "next/server";
import { eiaSeriesForQuery, searchEiaEnergyPrices } from "../../../../lib/eia-energy-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const CACHE_MS = 15 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 4;
const windows = new Map<string, { count: number; resetAt: number }>();
const responseCache = new Map<string, { promise: ReturnType<typeof searchEiaEnergyPrices>; expiresAt: number }>();

/** Private-key bridge for bounded EIA data; the key is never returned to the browser. */
export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  const query = body && typeof body === "object" && !Array.isArray(body) && "query" in body && typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 100) return reply({ error: "Enter a 2–100 character query." }, 400);
  if (!eiaSeriesForQuery(query).length) return reply({ code: "unsupported_topic", error: "EIA is only queried for supported energy benchmarks." }, 400);
  const apiKey = process.env.EIA_API_KEY?.trim() ?? "";
  if (!apiKey) return reply({ code: "not_configured", error: "EIA energy context needs a free EIA API key in private server settings." }, 503);
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowRequest(client)) return reply({ error: "EIA search limit reached. Try again in one minute." }, 429, { "Retry-After": "60" });
  const cacheKey = query.normalize("NFKC").toLocaleLowerCase();
  for (const [key, entry] of responseCache) if (entry.expiresAt <= Date.now()) responseCache.delete(key);
  try {
    let cached = responseCache.get(cacheKey);
    if (!cached) {
      if (responseCache.size >= 200) responseCache.delete(responseCache.keys().next().value!);
      cached = { promise: searchEiaEnergyPrices(query, apiKey), expiresAt: Date.now() + CACHE_MS };
      responseCache.set(cacheKey, cached);
      cached.promise.catch(() => { if (responseCache.get(cacheKey) === cached) responseCache.delete(cacheKey); });
    }
    return reply({ evidence: await cached.promise, retrievedAt: new Date().toISOString() }, 200);
  } catch (cause) {
    return reply({ error: cause instanceof Error ? cause.message : "EIA data is temporarily unavailable." }, 503);
  }
}

function allowRequest(client: string) {
  const now = Date.now();
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
  const current = windows.get(client);
  if (current && current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  if (current) current.count++;
  else {
    if (windows.size >= 1000) windows.delete(windows.keys().next().value!);
    windows.set(client, { count: 1, resetAt: now + WINDOW_MS });
  }
  return true;
}

function reply(body: Record<string, unknown>, status: number, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders } });
}
