import { NextRequest, NextResponse } from "next/server";
import { MARKET_COUNTRIES } from "../../../../lib/market-countries";
import { searchOfficialDrivers } from "../../../../lib/official-driver-sources";
import { LABOR_TERMS, officialDriverPlan } from "../../../../lib/official-driver-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { expiresAt: number; retrievedAt: string; promise: ReturnType<typeof searchOfficialDrivers> }>();
const windows = new Map<string, { resetAt: number; count: number }>();

export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 2048) return reply({ error: "Invalid request" }, 400);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid request" }, 400);
  const input = body as Record<string, unknown>;
  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  const country = typeof input.country === "string" ? input.country : "";
  if (topic.length < 2 || topic.length > 100 || !MARKET_COUNTRIES.some((item) => item.code === country)) return reply({ error: "Invalid topic or country" }, 400);
  const plan = officialDriverPlan(topic, country);
  if (!plan.length) return reply({ results: [], plan: [] }, 200);
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  for (const [key, value] of windows) if (value.resetAt <= now) windows.delete(key);
  const window = windows.get(client);
  if (window && window.count >= 8) return reply({ error: "Official-data search limit reached. Try again in one minute." }, 429);
  if (window) window.count++;
  else { if (windows.size >= 1000) windows.delete(windows.keys().next().value!); windows.set(client, { resetAt: now + 60_000, count: 1 }); }
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key);
  const selectedSeries = LABOR_TERMS.test(topic) ? "labor" : "prices";
  const cacheKey = `${country}:${plan.join(",")}:${selectedSeries}`;
  let entry = cache.get(cacheKey);
  if (!entry) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    entry = { expiresAt: now + CACHE_MS, retrievedAt: new Date(now).toISOString(), promise: searchOfficialDrivers(topic, country) };
    cache.set(cacheKey, entry);
    entry.promise.catch(() => { if (cache.get(cacheKey) === entry) cache.delete(cacheKey); });
  }
  try { return reply({ results: await entry.promise, plan, retrievedAt: entry.retrievedAt }, 200); }
  catch { return reply({ error: "Official-data context is temporarily unavailable" }, 503); }
}

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
