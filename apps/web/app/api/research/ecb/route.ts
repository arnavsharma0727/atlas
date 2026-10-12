import { NextRequest, NextResponse } from "next/server";
import { ecbCurrencies, fetchEcbReference, parseEcbReference } from "../../../../lib/ecb-reference";
import { bisEerAppliesToQuery } from "../../../../lib/bis-effective-exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let cache: { promise: ReturnType<typeof fetchEcbReference>; expiresAt: number } | undefined;
let backoffUntil = 0;

/** A shared warm-instance cache coalesces all lenses; query text never leaves Atlas. */
export async function POST(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  let raw: string;
  try { raw = await request.text(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (raw.length > 2048) return reply({ error: "Request too large" }, 413);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const country = typeof body.country === "string" ? body.country : "";
  if (query.length < 2 || query.length > 100 || !bisEerAppliesToQuery(query)) return reply({ error: "ECB context is limited to explicit currency/FX searches." }, 400);
  try { ecbCurrencies(country); } catch { return reply({ error: "Choose a supported Atlas lens." }, 400); }
  if (Date.now() < backoffUntil) return reply({ error: "ECB reference data is temporarily unavailable." }, 503);
  try {
    if (!cache || cache.expiresAt <= Date.now()) {
      const entry = { promise: fetchEcbReference(), expiresAt: Date.now() + 15 * 60000 };
      cache = entry;
      entry.promise.catch(() => {
        if (cache === entry) cache = undefined;
        backoffUntil = Date.now() + 60000;
      });
    }
    const sample = await cache.promise;
    return reply(parseEcbReference(sample.xml, country, Date.now(), sample.fetchedAt), 200);
  } catch {
    cache = undefined;
    backoffUntil = Date.now() + 60000;
    return reply({ error: "ECB reference data is temporarily unavailable." }, 503);
  }
}
function reply(body: object, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
