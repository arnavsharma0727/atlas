export type ManifoldForecast = {
  id: string;
  question: string;
  url: string;
  probability: number;
  volume24Hours: number;
  liquidity: number;
  closesAt: string | null;
  updatedAt: string;
};

type ApiMarket = {
  id?: string;
  question?: string;
  url?: string;
  probability?: number;
  volume24Hours?: number;
  totalLiquidity?: number;
  closeTime?: number | null;
  lastUpdatedTime?: number;
  isResolved?: boolean;
  outcomeType?: string;
  token?: string;
};

const API = "https://api.manifold.markets/v0/search-markets";
const STOP_WORDS = new Set(["a", "an", "and", "are", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"]);

/** Read-only public forecast search. Keep only active, binary MANA (play-money) markets. */
export async function searchManifoldForecasts(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<ManifoldForecast[]> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a search phrase between 2 and 100 characters.");
  const terms = meaningfulTerms(query);
  if (!terms.length) return [];

  const params = new URLSearchParams({ term: query, sort: "24-hour-vol", filter: "open", contractType: "BINARY", limit: "20" });
  const response = await fetcher(`${API}?${params}`, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new Error("Manifold public search is rate-limiting requests. Try again later.");
  if (!response.ok) throw new Error("Manifold public forecast search is temporarily unavailable.");
  const body = await response.json() as unknown;
  if (!Array.isArray(body)) return [];

  return (body as ApiMarket[]).flatMap((market) => {
    const id = market.id;
    const question = market.question?.trim();
    const url = safeMarketUrl(market.url);
    const closeTime = typeof market.closeTime === "number" ? market.closeTime : null;
    const probability = market.probability;
    const volume24Hours = market.volume24Hours;
    const liquidity = market.totalLiquidity;
    if (
      !id || !question || !url || market.isResolved !== false || market.outcomeType !== "BINARY" || market.token !== "MANA" ||
      typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1 ||
      typeof volume24Hours !== "number" || !Number.isFinite(volume24Hours) || volume24Hours <= 0 ||
      typeof liquidity !== "number" || !Number.isFinite(liquidity) || liquidity <= 0 ||
      (closeTime !== null && (!Number.isFinite(closeTime) || closeTime <= now)) || !matchesQuery(question, query, terms)
    ) return [];

    const updatedTime = typeof market.lastUpdatedTime === "number" && Number.isFinite(market.lastUpdatedTime) && market.lastUpdatedTime <= now
      ? market.lastUpdatedTime
      : now;
    return [{
      id,
      question: question.slice(0, 400),
      url,
      probability,
      volume24Hours,
      liquidity,
      closesAt: closeTime === null ? null : new Date(closeTime).toISOString(),
      updatedAt: new Date(updatedTime).toISOString(),
    }];
  });
}

function meaningfulTerms(value: string) {
  return [...new Set(value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function matchesQuery(question: string, query: string, terms: string[]) {
  const tokens = question.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalized = tokens.join(" ");
  const quoted = query.trim().match(/^"(.+)"$/u)?.[1];
  if (quoted) {
    const phrase = quoted.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
    return Boolean(phrase) && normalized.includes(phrase);
  }
  const titleTerms = new Set(tokens);
  return terms.every((term) => titleTerms.has(term));
}

function safeMarketUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && url.hostname === "manifold.markets" && !url.username && !url.password && !url.port
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
