import { XMLParser } from "fast-xml-parser";
import { THE_CONVERSATION_EDITIONS, hasAttributionNoDerivativesRights } from "./connectors/the-conversation";
import { withFetchTimeout } from "./fetch-with-timeout";
import { headlineMatchesQuery } from "./global-voices-search";

export type TheConversationSearchEdition = {
  code: string;
  edition: string;
  language: string;
  articles: Array<{ id: string; title: string; url: string; publishedAt: string; authors: string[] }>;
  error: string | null;
};

const MAX_FEED_BYTES = 1_500_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Search six first-party, public Atom feeds. Only licensed titles, authors, dates, and links escape this adapter. */
export async function searchTheConversation(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<TheConversationSearchEdition[]> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase of 2–100 characters.");
  const boundedFetch = withFetchTimeout(fetcher, 8_000);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const oldest = now - MAX_AGE_MS;

  return Promise.all(THE_CONVERSATION_EDITIONS.map(async (edition) => {
    try {
      const response = await boundedFetch(edition.feed, {
        headers: { accept: "application/atom+xml, application/xml" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Rate limited" : "Feed unavailable");
      const finalUrl = new URL(response.url || edition.feed);
      if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "theconversation.com" || finalUrl.pathname !== new URL(edition.feed).pathname) {
        throw new Error("Feed redirected outside its reviewed publisher endpoint");
      }
      const xml = await readBoundedText(response, MAX_FEED_BYTES, 8_000);
      if (xml === null) throw new Error("Feed exceeded the response-size limit");
      const parsed = parser.parse(xml) as { feed?: { id?: unknown; title?: unknown; entry?: unknown } };
      if (!parsed.feed?.id || !parsed.feed.title) throw new Error("Unexpected Atom feed");
      const rawEntries = parsed.feed.entry ?? [];
      const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
      const articles = entries.flatMap((entry: Record<string, unknown>, index): TheConversationSearchEdition["articles"] => {
        const title = typeof entry.title === "string" ? entry.title.trim().slice(0, 300) : "";
        const published = typeof entry.published === "string" ? Date.parse(entry.published) : NaN;
        const rights = typeof entry.rights === "string" ? entry.rights : "";
        const authorRows = Array.isArray(entry.author) ? entry.author : [entry.author];
        const authors = authorRows.flatMap((value) => {
          const author = value && typeof value === "object" ? value as Record<string, unknown> : null;
          return typeof author?.name === "string" && author.name.trim() ? [author.name.trim().slice(0, 120)] : [];
        }).slice(0, 8);
        const linkRows = Array.isArray(entry.link) ? entry.link : [entry.link];
        const alternate = linkRows.find((value) => value && typeof value === "object" &&
          (value as Record<string, unknown>)["@_rel"] === "alternate" && typeof (value as Record<string, unknown>)["@_href"] === "string") as Record<string, unknown> | undefined;
        let url: URL;
        try { url = new URL(typeof alternate?.["@_href"] === "string" ? alternate["@_href"] : ""); }
        catch { return []; }
        if (!title || !authors.length || !Number.isFinite(published) || published < oldest || published > now ||
            url.protocol !== "https:" || url.hostname !== "theconversation.com" || url.pathname === "/" ||
            !hasAttributionNoDerivativesRights(rights) || !headlineMatchesQuery(title, query)) return [];
        return [{ id: `${edition.code}:${index}`, title, url: url.toString(), publishedAt: new Date(published).toISOString(), authors }];
      }).slice(0, 5);
      return { code: edition.code, edition: edition.label, language: edition.language, articles, error: null };
    } catch (cause) {
      return {
        code: edition.code,
        edition: edition.label,
        language: edition.language,
        articles: [],
        error: cause instanceof Error && cause.name === "TimeoutError" ? "Timed out" : cause instanceof Error ? cause.message : "Feed unavailable",
      };
    }
  }));
}

async function readBoundedText(response: Response, maximumBytes: number, timeoutMs: number): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, timeoutMs);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw new Error("Feed response body timed out");
  return Buffer.concat(chunks, total).toString("utf8");
}
