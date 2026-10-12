import { XMLParser } from "fast-xml-parser";
import { matchesScholarlyContext } from "./scholarly-context-relevance";
import { publicationTimestampUTC } from "./publication-date";

export type ArxivRecord = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  category: string;
};

const MAX_BODY_BYTES = 1_000_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });

/** Query the public Atom API, retain only title/ID/date/category, and discard abstracts. */
export async function searchArxiv(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ArxivRecord[]> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  const terms = query.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!terms.length) return [];
  const oldestDate = new Date(now);
  oldestDate.setUTCFullYear(oldestDate.getUTCFullYear() - 5);
  const safeTerms = terms.slice(0, 6).map((term) => `all:${term}`).join(" AND ");
  const endpoint = new URL("https://export.arxiv.org/api/query");
  endpoint.search = new URLSearchParams({
    search_query: safeTerms,
    start: "0",
    max_results: "30",
    sortBy: "relevance",
    sortOrder: "descending",
  }).toString();
  const response = await fetcher(endpoint, {
    headers: { accept: "application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 429
    ? "arXiv public search is rate-limited. Try again later."
    : "arXiv research metadata is temporarily unavailable.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("arXiv returned an oversized response.");
  const xml = await response.text();
  if (new TextEncoder().encode(xml).byteLength > MAX_BODY_BYTES) throw new Error("arXiv returned an oversized response.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("arXiv returned an unexpected XML document.");
  let payload: unknown;
  try { payload = parser.parse(xml); } catch { throw new Error("arXiv returned invalid XML."); }
  if (!payload || typeof payload !== "object" || !("feed" in payload) || !payload.feed || typeof payload.feed !== "object") {
    throw new Error("arXiv returned an unexpected response.");
  }
  const feed = payload.feed as Record<string, unknown>;
  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
  const oldest = oldestDate.getTime();
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase();
  return entries.flatMap((value): ArxivRecord[] => {
    if (!value || typeof value !== "object") return [];
    const entry = value as Record<string, unknown>;
    const title = cleanText(entry.title, 300);
    const rawId = typeof entry.id === "string" ? entry.id : "";
    const rawDate = typeof entry.published === "string" ? entry.published : "";
    const timestamp = publicationTimestampUTC(rawDate);
    const categoryValue = entry["arxiv:primary_category"];
    const category = categoryValue && typeof categoryValue === "object" && "@_term" in categoryValue && typeof categoryValue["@_term"] === "string"
      ? categoryValue["@_term"].slice(0, 40)
      : "";
    const url = safeArxivUrl(rawId);
    if (!title || !url || timestamp === null || timestamp < oldest || timestamp > now || !titleMatches(title, normalizedQuery) || !matchesScholarlyContext(query, title, "", category)) return [];
    return [{ id: url.split("/abs/")[1], title, url, publishedAt: new Date(timestamp).toISOString(), category }];
  }).slice(0, 12);
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function safeArxivUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname !== "arxiv.org" || !/^\/abs\/[\w.-]+(?:\/v\d+)?$/u.test(url.pathname)) return null;
    return `https://arxiv.org${url.pathname}`;
  } catch {
    return null;
  }
}

function titleMatches(title: string, query: string) {
  const normalizedTitle = title.normalize("NFKC").toLocaleLowerCase();
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query)) return normalizedTitle.includes(query);
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = terms.filter((term) => term.length > 1 && !new Set(["a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with"]).has(term));
  const titleTerms = new Set(normalizedTitle.match(/[\p{L}\p{N}]+/gu) ?? []);
  return meaningful.length ? meaningful.every((term) => titleTerms.has(term)) : normalizedTitle.includes(query);
}
