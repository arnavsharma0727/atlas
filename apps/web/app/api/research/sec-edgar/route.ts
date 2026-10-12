import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retained for old clients. Operator policy disables all visitor SEC access. */
export async function POST() {
  return NextResponse.json(
    { code: "disabled", error: "SEC requests are disabled by operator policy." },
    { status: 410, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
