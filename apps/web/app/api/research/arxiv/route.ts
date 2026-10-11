import { NextRequest, NextResponse } from "next/server";
import { searchArxiv } from "../../../../lib/arxiv-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const windows = new Map<string, { count: number; resetAt: number }>();
const responseCache = new Map<string, { promise: ReturnType<typeof searchArxiv>; expiresAt: number }>();
let arxivRequestQueue = Promise.resolve();
let lastRequestAt = 0;

/** Keyless public metadata bridge. Caches results for a day and spaces upstream calls by 3 seconds. */
export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  const query = body && typeof body === "object" && !Array.isArray(body) && "query" in body && typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 100) return reply({ error: "Enter a 2–100 character query." }, 400);
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowRequest(client)) return reply({ error: "arXiv search limit reached. Try again in one minute." }, 429, { "Retry-After": "60" });
  const cacheKey = query.normalize("NFKC").toLocaleLowerCase();
  for (const [key, entry] of responseCache) if (entry.expiresAt <= Date.now()) responseCache.delete(key);
  try {
    let cached = responseCache.get(cacheKey);
    if (!cached) {
      if (responseCache.size >= 300) responseCache.delete(responseCache.keys().next().value!);
      cached = { promise: enqueueArxivRequest(query), expiresAt: Date.now() + CACHE_MS };
      responseCache.set(cacheKey, cached);
      cached.promise.catch(() => {
        if (responseCache.get(cacheKey) === cached) responseCache.delete(cacheKey);
      });
    }
    return reply({ records: await cached.promise }, 200);
  } catch (cause) {
    return reply({ error: cause instanceof Error ? cause.message : "arXiv research metadata is temporarily unavailable." }, 503);
  }
}

function enqueueArxivRequest(query: string) {
  const result = arxivRequestQueue.then(async () => {
    const remainingDelay = Math.max(0, 3_000 - (Date.now() - lastRequestAt));
    if (remainingDelay) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    lastRequestAt = Date.now();
    return searchArxiv(query);
  });
  arxivRequestQueue = result.then(() => undefined, () => undefined);
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
