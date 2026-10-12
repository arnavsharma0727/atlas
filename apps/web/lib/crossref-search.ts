import { matchesScholarlyContext } from "./scholarly-context-relevance";
import { publicationDateFromParts } from "./publication-date";
import { matchesScholarlyTitle } from "./scholarly-title-match";

export type CrossrefWork = {
  doi: string;
  title: string;
  url: string;
  publisher: string;
  containerTitle: string;
  publishedAt: string;
  /** Provider calendar precision; publishedAt is only the earliest-date sorting anchor. */
  publicationDate?: string;
  language: string;
};

type CrossrefItem = {
  DOI?: unknown;
  title?: unknown;
  publisher?: unknown;
  "container-title"?: unknown;
  published?: { "date-parts"?: unknown };
};

const MAX_BODY_BYTES = 1_000_000;

/** Search Crossref's public metadata only; never fetch abstracts or publisher pages. */
export async function searchCrossrefWorks(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<CrossrefWork[]> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  const oldestDate = new Date(now);
  oldestDate.setUTCFullYear(oldestDate.getUTCFullYear() - 5);

  const endpoint = new URL("https://api.crossref.org/works");
  endpoint.search = new URLSearchParams({
    "query.title": query,
    rows: "25",
    sort: "relevance",
    order: "desc",
    select: "DOI,title,publisher,container-title,published",
    filter: `from-pub-date:${oldestDate.toISOString().slice(0, 10)},until-pub-date:${new Date(now).toISOString().slice(0, 10)}`,
  }).toString();

  const response = await fetcher(endpoint, {
    headers: {
      accept: "application/json",
      "user-agent": "Atlas/1.0 (https://signal-scout-xi-ruby.vercel.app/sources)",
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 429
    ? "Crossref public search is rate-limited. Try again later."
    : "Crossref research metadata is temporarily unavailable.");

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("Crossref returned an oversized response.");
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("Crossref returned an oversized response.");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new Error("Crossref returned an invalid response."); }
  if (!payload || typeof payload !== "object" || !("message" in payload) || !payload.message || typeof payload.message !== "object" || !("items" in payload.message) || !Array.isArray(payload.message.items)) {
    throw new Error("Crossref returned an unexpected response.");
  }

  const oldest = oldestDate.getTime();
  return (payload.message.items as CrossrefItem[]).flatMap((item) => {
    const doi = typeof item.DOI === "string" ? item.DOI.trim() : "";
    const title = Array.isArray(item.title) && typeof item.title[0] === "string" ? item.title[0].replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const containerTitle = Array.isArray(item["container-title"]) ? scalar(item["container-title"][0], 160) : "";
    const dateParts = item.published?.["date-parts"];
    const published = publicationDateFromParts(Array.isArray(dateParts) && dateParts.length === 1 ? dateParts[0] : null);
    if (!/^10\.\d{4,9}\/\S+$/u.test(doi) || !title || !matchesScholarlyTitle(title, query) || !matchesScholarlyContext(query, title, containerTitle) || !published) return [];
    if (published.timestamp < oldest || published.timestamp > now) return [];
    const url = `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`;
    return [{
      doi,
      title,
      url,
      publisher: scalar(item.publisher, 120),
      containerTitle,
      publishedAt: new Date(published.timestamp).toISOString(),
      publicationDate: published.value,
      language: "Not reported",
    }];
  }).slice(0, 12);
}

function scalar(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}
