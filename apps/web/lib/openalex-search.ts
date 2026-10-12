export type OpenAlexWork = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  workType: string;
  openAccess: boolean | null;
};

type ApiWork = {
  id?: unknown;
  title?: unknown;
  doi?: unknown;
  publication_date?: unknown;
  type?: unknown;
  open_access?: { is_oa?: unknown };
};

const MAX_BODY_BYTES = 1_000_000;
const STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/** Keyless OpenAlex search; retain only title-level metadata, never abstracts or authors. */
export async function searchOpenAlexWorks(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<OpenAlexWork[]> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 5);
  const endpoint = new URL("https://api.openalex.org/works");
  endpoint.search = new URLSearchParams({
    search: query,
    per_page: "25",
    select: "id,doi,title,publication_date,type,open_access",
    sort: "relevance_score:desc",
  }).toString();
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetcher(endpoint, {
        headers: { accept: "application/json", "user-agent": "Atlas/1.0 (https://signal-scout-xi-ruby.vercel.app/sources)" },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
    } catch (cause) {
      if (attempt > 0) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    if (attempt === 0 && [502, 503, 504].includes(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    break;
  }
  if (!response) throw new Error("OpenAlex research metadata is temporarily unavailable.");
  if (!response.ok) throw new Error(response.status === 429
    ? "OpenAlex keyless usage limit reached. Try again later."
    : "OpenAlex research metadata is temporarily unavailable.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("OpenAlex returned an oversized response.");
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("OpenAlex returned an oversized response.");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new Error("OpenAlex returned an invalid response."); }
  if (!payload || typeof payload !== "object" || !("results" in payload) || !Array.isArray(payload.results)) {
    throw new Error("OpenAlex returned an unexpected response.");
  }
  const terms = query.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = terms.filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  const oldestTime = oldest.getTime();
  return (payload.results as ApiWork[]).flatMap((work) => {
    const title = typeof work.title === "string" ? work.title.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const titleNormalized = title.normalize("NFKC").toLocaleLowerCase();
    const publishedAt = typeof work.publication_date === "string" ? work.publication_date : "";
    const timestamp = Date.parse(`${publishedAt}T00:00:00Z`);
    const rawId = typeof work.id === "string" ? work.id : "";
    const doi = typeof work.doi === "string" ? work.doi : "";
    const url = safeWorkUrl(doi, rawId);
    if (!title || !url || !Number.isFinite(timestamp) || timestamp < oldestTime || timestamp > now ||
      (meaningful.length ? !meaningful.every((term) => titleNormalized.includes(term)) : !titleNormalized.includes(query.normalize("NFKC").toLocaleLowerCase()))) return [];
    return [{
      id: url,
      title,
      url,
      publishedAt: new Date(timestamp).toISOString(),
      workType: typeof work.type === "string" ? work.type.slice(0, 60) : "",
      openAccess: typeof work.open_access?.is_oa === "boolean" ? work.open_access.is_oa : null,
    }];
  }).slice(0, 12);
}

function safeWorkUrl(doi: string, rawId: string) {
  if (doi) {
    try {
      const url = new URL(doi);
      if (url.protocol === "https:" && url.hostname === "doi.org" && /^\/10\.\d{4,9}\/\S+$/u.test(url.pathname)) return url.toString();
    } catch { /* fall through to validated OpenAlex identifier */ }
  }
  try {
    const url = new URL(rawId);
    return url.protocol === "https:" && url.hostname === "openalex.org" && /^\/W\d+$/u.test(url.pathname) ? url.toString() : null;
  } catch { return null; }
}
