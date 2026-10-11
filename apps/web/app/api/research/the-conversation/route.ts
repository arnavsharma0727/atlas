import { NextRequest, NextResponse } from "next/server";
import { searchTheConversation } from "../../../../lib/the-conversation-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 4;
const requestWindows = new Map<string, { count: number; resetAt: number }>();

/** Bounded no-store route over The Conversation's reviewed first-party Atom feeds. */
export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  const query = body && typeof body === "object" && !Array.isArray(body) && "query" in body && typeof body.query === "string"
    ? body.query.trim() : "";
  if (query.length < 2 || query.length > 100) return reply({ error: "Enter a 2–100 character query." }, 400);
  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowRequest(client)) return reply({ error: "Search limit reached. Try again in one minute." }, 429, { "Retry-After": "60" });
  const editions = await searchTheConversation(query);
  return reply({ editions, partial: editions.some(({ error }) => error) }, 200);
}

function allowRequest(client: string) {
  const now = Date.now();
  for (const [key, window] of requestWindows) if (window.resetAt <= now) requestWindows.delete(key);
  const current = requestWindows.get(client);
  if (current && current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  if (current) current.count++;
  else {
    if (requestWindows.size >= 1000) requestWindows.delete(requestWindows.keys().next().value!);
    requestWindows.set(client, { count: 1, resetAt: now + WINDOW_MS });
  }
  return true;
}

function reply(body: Record<string, unknown>, status: number, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders } });
}
