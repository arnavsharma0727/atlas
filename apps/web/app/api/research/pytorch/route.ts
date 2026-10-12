import { NextRequest, NextResponse } from "next/server";
import { pytorchAppliesToQuery, searchPytorchForum } from "../../../../lib/pytorch-forum";
import { withFetchTimeout } from "../../../../lib/fetch-with-timeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared across queries but only within this warm server instance. No persistence.
const cache = new Map<string, { expiresAt: number; response: Promise<Response> }>();
const clients = new Map<string, { expiresAt: number; count: number }>();
let upstreamWindow = { expiresAt: 0, count: 0 };
const providerFetch: typeof fetch = async (input, init) => {
  const key = String(input);
  if (!/^https:\/\/discuss\.pytorch\.org\/(?:latest|t\/[1-9]\d*)\.json$/u.test(key)) throw new Error("Unlisted PyTorch endpoint.");
  const now = Date.now();
  for (const [path, entry] of cache) if (entry.expiresAt <= now) cache.delete(path);
  let entry = cache.get(key);
  if (!entry) {
    if (upstreamWindow.expiresAt <= now) upstreamWindow = { expiresAt: now + 60_000, count: 0 };
    if (upstreamWindow.count >= 10) throw new Error("PyTorch upstream request ceiling reached; try later.");
    upstreamWindow.count++;
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    // Independent deadline avoids one visitor canceling a coalesced provider read.
    const response = withFetchTimeout(fetch, 6000, 1_500_000)(input, { ...init, signal: undefined }).then((result) => {
      const headers = new Headers(result.headers);
      headers.set("x-atlas-provider-fetched-at", new Date().toISOString());
      return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
    });
    entry = { expiresAt: now + 15 * 60_000, response };
    cache.set(key, entry);
    const current = entry;
    void response.then((result) => {
      if (!result.ok && cache.get(key) === current) current.expiresAt = Date.now() + 60_000;
    }, () => {
      if (cache.get(key) === current) current.expiresAt = Date.now() + 60_000;
    });
  }
  return (await entry.response).clone();
};

export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid JSON" }, 400); }
  const query = body && typeof body === "object" && "query" in body && typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 100 || !pytorchAppliesToQuery(query)) return reply({ error: "Enter an explicit GPU/inference/framework query (2–100 characters)." }, 400);
  const now = Date.now();
  for (const [key, client] of clients) if (client.expiresAt <= now) clients.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  let client = clients.get(ip);
  if (client && client.count >= 3) return reply({ error: "PyTorch query limit reached." }, 429, { "Retry-After": "60" });
  if (!client) {
    if (clients.size >= 1000) clients.delete(clients.keys().next().value!);
    client = { expiresAt: now + 60_000, count: 0 };
    clients.set(ip, client);
  }
  client.count++;
  try { return reply({ sample: await searchPytorchForum(query, providerFetch) }, 200); }
  catch { return reply({ error: "PyTorch latest-topic feed is temporarily unavailable or rate-limited." }, 503); }
}

function reply(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}
