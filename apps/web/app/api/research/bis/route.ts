import { NextRequest, NextResponse } from "next/server";
import { bisEerAppliesToQuery, searchBisEffectiveExchangeRates } from "../../../../lib/bis-effective-exchange";
import { MARKET_COUNTRIES } from "../../../../lib/market-countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const CACHE_MS = 15 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const windows = new Map<string, { count: number; resetAt: number }>();
const responseCache = new Map<string, { promise: ReturnType<typeof searchBisEffectiveExchangeRates>; expiresAt: number }>();

/** Bounded keyless proxy: visitor text is never sent upstream or retained. */
export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  const query = body && typeof body === "object" && !Array.isArray(body) && "query" in body && typeof body.query === "string" ? body.query.trim() : "";
  const country = body && typeof body === "object" && !Array.isArray(body) && "country" in body && typeof body.country === "string" ? body.country : "";
  if (query.length < 2 || query.length > 100) return reply({ error: "Enter a 2–100 character query." }, 400);
  if (!bisEerAppliesToQuery(query)) return reply({ code: "unsupported_topic", error: "BIS effective exchange rates are only queried for currency or FX searches." }, 400);
  if (!MARKET_COUNTRIES.some(({ code }) => code === country)) return reply({ error: "Choose a supported Atlas country lens." }, 400);
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowRequest(client)) return reply({ error: "BIS data search limit reached. Try again in one minute." }, 429, { "Retry-After": "60" });
  for (const [key, entry] of responseCache) if (entry.expiresAt <= Date.now()) responseCache.delete(key);
  const cacheKey = country;
  try {
    let cached = responseCache.get(cacheKey);
    if (!cached) {
      if (responseCache.size >= 100) responseCache.delete(responseCache.keys().next().value!);
      cached = { promise: searchBisEffectiveExchangeRates(query, country), expiresAt: Date.now() + CACHE_MS };
      responseCache.set(cacheKey, cached);
      cached.promise.catch(() => { if (responseCache.get(cacheKey) === cached) responseCache.delete(cacheKey); });
    }
    return reply({ ...(await cached.promise), retrievedAt: new Date().toISOString() }, 200);
  } catch {
    return reply({ error: "BIS exchange-rate data is temporarily unavailable." }, 503);
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
