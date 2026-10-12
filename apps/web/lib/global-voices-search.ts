export const GLOBAL_VOICES_SEARCH_EDITIONS = [
  { language: "en", label: "English", host: "globalvoices.org" },
  { language: "es", label: "Spanish", host: "es.globalvoices.org" },
  { language: "fr", label: "French", host: "fr.globalvoices.org" },
  { language: "pt", label: "Portuguese", host: "pt.globalvoices.org" },
  { language: "ar", label: "Arabic", host: "ar.globalvoices.org" },
  { language: "ru", label: "Russian", host: "ru.globalvoices.org" },
  { language: "it", label: "Italian", host: "it.globalvoices.org" },
  { language: "nl", label: "Dutch", host: "nl.globalvoices.org" },
  { language: "yo", label: "Yoruba", host: "yo.globalvoices.org" },
  { language: "ja", label: "Japanese", host: "jp.globalvoices.org" },
  { language: "bn", label: "Bengali", host: "bn.globalvoices.org" },
  { language: "uk", label: "Ukrainian", host: "uk.globalvoices.org" },
  { language: "el", label: "Greek", host: "el.globalvoices.org" },
  { language: "ca", label: "Catalan", host: "ca.globalvoices.org" },
] as const;

export type GlobalVoicesArticle = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  language: string;
  edition: string;
};

export type GlobalVoicesEditionResult = {
  language: string;
  edition: string;
  articles: GlobalVoicesArticle[];
  error: string | null;
};

type WordPressPost = {
  id?: unknown;
  date_gmt?: unknown;
  link?: unknown;
  title?: { rendered?: unknown };
};

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Search the public, localized WordPress APIs; fetch headline metadata only. */
export async function searchGlobalVoices(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<GlobalVoicesEditionResult[]> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  const after = new Date(now - MAX_AGE_MS).toISOString();
  const before = new Date(now).toISOString();

  return Promise.all(GLOBAL_VOICES_SEARCH_EDITIONS.map(async (edition) => {
    const endpoint = new URL(`https://${edition.host}/wp-json/wp/v2/posts`);
    endpoint.search = new URLSearchParams({
      search: query,
      after,
      before,
      orderby: "date",
      order: "desc",
      per_page: "5",
      _fields: "id,date_gmt,link,title",
    }).toString();
    try {
      const response = await fetcher(endpoint, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Rate limited" : "Unavailable");
      const body = await response.json() as unknown;
      if (!Array.isArray(body)) throw new Error("Unexpected response");
      const oldest = now - MAX_AGE_MS;
      const articles = body.flatMap((value): GlobalVoicesArticle[] => {
        if (!value || typeof value !== "object") return [];
        const post = value as WordPressPost;
        const id = typeof post.id === "number" ? String(post.id) : "";
        const rawTitle = typeof post.title?.rendered === "string" ? post.title.rendered : "";
        const title = htmlText(rawTitle).slice(0, 300);
        const url = safeEditionUrl(post.link, edition.host);
        const rawDate = typeof post.date_gmt === "string" ? post.date_gmt : "";
        const publishedAt = Date.parse(rawDate && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawDate) ? `${rawDate}Z` : rawDate);
        if (!id || !title || !url || !Number.isFinite(publishedAt) || publishedAt < oldest || publishedAt > now || !headlineMatchesQuery(title, query)) return [];
        return [{ id: `${edition.language}:${id}`, title, url, publishedAt: new Date(publishedAt).toISOString(), language: edition.language, edition: edition.label }];
      });
      return { language: edition.language, edition: edition.label, articles, error: null };
    } catch (cause) {
      return {
        language: edition.language,
        edition: edition.label,
        articles: [],
        error: cause instanceof Error && cause.name === "TimeoutError" ? "Timed out" : cause instanceof Error ? cause.message : "Unavailable",
      };
    }
  }));
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"]);

export function headlineMatchesQuery(title: string, query: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
  const tokens = (value: string) => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  const queryTerms = tokens(query);
  const meaningful = queryTerms.filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  const headline = normalize(title);
  const quoted = query.trim().match(/^"(.+)"$/u)?.[1];
  if (quoted) return headlineTokens(headline).includes(headlineTokens(normalize(quoted)));
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query)) {
    return meaningful.length > 0 && meaningful.every((term) => headline.includes(term));
  }
  if (!meaningful.length) return headline.includes(normalize(query));
  const titleTerms = new Set(tokens(title));
  return meaningful.every((term) => titleTerms.has(term));
}

function headlineTokens(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
}

function safeEditionUrl(value: unknown, host: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && url.pathname !== "/" ? url.toString() : null;
  } catch {
    return null;
  }
}

function htmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => decode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => decode(parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function decode(codePoint: number) {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : "�";
}
