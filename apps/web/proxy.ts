import { NextResponse, type NextRequest } from "next/server";

/** Retire the old scraper and ingestion endpoints without leaving them callable. */
export function proxy(_request: NextRequest) {
  return NextResponse.json({ error: "This Atlas connector has been retired." }, { status: 410 });
}

export const config = {
  matcher: ["/api/research/:path*", "/api/ingest", "/api/metrics/:path*"],
};
