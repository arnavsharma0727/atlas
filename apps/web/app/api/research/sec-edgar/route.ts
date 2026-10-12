import { NextRequest, NextResponse } from "next/server";
import { searchSecEdgarFilings } from "../../../../lib/sec-edgar-research-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const CACHE_MS = 5 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 2;
const windows = new Map<string, { count: number; resetAt: number }>();
const responseCache = new Map<string, { promise: ReturnType<typeof searchSecEdgarFilings>; expiresAt: number }>();
let requestQueue = Promise.resolve();

/** Server-side bridge: SEC requires a descriptive contact User-Agent and does not enable browser CORS. */
export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  const query = body && typeof body === "object" && !Array.isArray(body) && "query" in body && typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 100) return reply({ error: "Enter a 2–100 character company name or ticker." }, 400);
  const userAgent = process.env.SEC_USER_AGENT ?? "";
  if (!/(?:^|\s)[^\s@]+@[^\s@]+\.[^\s@]+(?:\s|$)/u.test(userAgent)) {
    return reply({ error: "SEC EDGAR search is not configured with an operator contact email." }, 503);
  }
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowRequest(client)) return reply({ error: "SEC EDGAR search limit reached. Try again in one minute." }, 429, { "Retry-After": "60" });
  const cacheKey = query.normalize("NFKC").toLocaleLowerCase();
  for (const [key, entry] of responseCache) if (entry.expiresAt <= Date.now()) responseCache.delete(key);
  try {
    let cached = responseCache.get(cacheKey);
    if (!cached) {
      if (responseCache.size >= 300) responseCache.delete(responseCache.keys().next().value!);
      cached = { promise: enqueueRequest(query, userAgent), expiresAt: Date.now() + CACHE_MS };
      responseCache.set(cacheKey, cached);
      cached.promise.catch(() => { if (responseCache.get(cacheKey) === cached) responseCache.delete(cacheKey); });
    }
    return reply({ ...await cached.promise, retrievedAt: new Date().toISOString() }, 200);
  } catch (cause) {
    return reply({ error: cause instanceof Error ? cause.message : "SEC EDGAR is temporarily unavailable." }, 503);
  }
}

function enqueueRequest(query: string, userAgent: string) {
  const result = requestQueue.then(() => searchSecEdgarFilings(query, userAgent));
  requestQueue = result.then(() => undefined, () => undefined);
  return result;
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
