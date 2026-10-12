export type SecIssuer = {
  cik: string;
  ticker: string;
  name: string;
};

export type SecFiling = {
  accession: string;
  form: string;
  filedAt: string;
  title: string;
  url: string;
};

export type SecFilingSearch = {
  issuer: SecIssuer | null;
  filings: SecFiling[];
};

type CompanyIndexRow = { cik_str?: unknown; ticker?: unknown; title?: unknown };
type Submissions = {
  name?: unknown;
  filings?: {
    recent?: {
      form?: unknown;
      accessionNumber?: unknown;
      filingDate?: unknown;
      primaryDocument?: unknown;
      primaryDocDescription?: unknown;
    };
  };
};

const MAX_INDEX_BYTES = 4_000_000;
const MAX_SUBMISSIONS_BYTES = 4_000_000;
const ALLOWED_FORMS = new Set(["8-K", "10-Q", "10-K", "20-F", "40-F", "6-K"]);
const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc"]);

/** Exact SEC ticker/issuer lookup followed by recent filing metadata only. */
export async function searchSecEdgarFilings(
  input: string,
  userAgent: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<SecFilingSearch> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100) throw new Error("Enter a 2–100 character company name or ticker.");
  if (!/(?:^|\s)[^\s@]+@[^\s@]+\.[^\s@]+(?:\s|$)/u.test(userAgent)) {
    throw new Error("SEC EDGAR search is not configured with a contact email in its User-Agent.");
  }

  const indexResponse = await fetcher("https://www.sec.gov/files/company_tickers.json", {
    headers: { accept: "application/json", "user-agent": userAgent },
    cache: "force-cache",
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!indexResponse.ok) throw upstreamError(indexResponse.status);
  const indexRaw = await readBoundedBody(indexResponse, MAX_INDEX_BYTES);
  const index = parseJson<unknown>(indexRaw);
  if (!index || typeof index !== "object" || Array.isArray(index)) throw new Error("SEC EDGAR returned an unexpected issuer index.");

  const normalizedQuery = normalizeIssuerName(query);
  const tickerQuery = query.replace(/[^\p{L}\p{N}.-]/gu, "").toLocaleUpperCase();
  const rows = Object.values(index as Record<string, CompanyIndexRow>).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const cik = Number(row.cik_str);
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toLocaleUpperCase() : "";
    const name = typeof row.title === "string" ? row.title.replace(/\s+/gu, " ").trim().slice(0, 180) : "";
    if (!Number.isInteger(cik) || cik <= 0 || !/^[\p{L}\p{N}.-]{1,16}$/u.test(ticker) || !name) return [];
    return [{ cik: String(cik).padStart(10, "0"), ticker, name }];
  });
  const issuer = rows.find((row) => row.ticker === tickerQuery) ?? rows.find((row) => normalizeIssuerName(row.name) === normalizedQuery) ?? null;
  if (!issuer) return { issuer: null, filings: [] };

  const submissionsResponse = await fetcher(`https://data.sec.gov/submissions/CIK${issuer.cik}.json`, {
    headers: { accept: "application/json", "user-agent": userAgent },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!submissionsResponse.ok) throw upstreamError(submissionsResponse.status);
  const submissionsRaw = await readBoundedBody(submissionsResponse, MAX_SUBMISSIONS_BYTES);
  const submissions = parseJson<Submissions>(submissionsRaw);
  const recent = submissions?.filings?.recent;
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.accessionNumber) || !Array.isArray(recent.filingDate) || !Array.isArray(recent.primaryDocument)) {
    return { issuer: { ...issuer, name: typeof submissions?.name === "string" ? submissions.name.slice(0, 180) : issuer.name }, filings: [] };
  }

  const forms = recent.form as unknown[];
  const accessions = recent.accessionNumber as unknown[];
  const filingDates = recent.filingDate as unknown[];
  const documents = recent.primaryDocument as unknown[];
  const descriptions = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription as unknown[] : [];
  const oldest = now - 3 * 365.25 * 24 * 60 * 60 * 1000;
  const filings = forms.flatMap((rawForm, index): SecFiling[] => {
    const form = typeof rawForm === "string" ? rawForm : "";
    const accession = accessions[index];
    const filed = filingDates[index];
    const document = documents[index];
    const date = typeof filed === "string" ? Date.parse(`${filed}T00:00:00Z`) : NaN;
    if (!ALLOWED_FORMS.has(form) || !Number.isFinite(date) || date < oldest || date > now ||
      typeof accession !== "string" || !/^\d{10}-\d{2}-\d{6}$/u.test(accession) ||
      typeof document !== "string" || !/^[\p{L}\p{N}_.-]{1,200}$/u.test(document)) return [];
    const accessionPath = accession.replaceAll("-", "");
    const description = typeof descriptions[index] === "string"
      ? descriptions[index].replace(/\s+/gu, " ").trim().slice(0, 120)
      : "";
    return [{
      accession,
      form,
      filedAt: new Date(date).toISOString(),
      title: `${form} filing${description ? ` · ${description}` : ""}`,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${accessionPath}/${document}`,
    }];
  }).sort((left, right) => Date.parse(right.filedAt) - Date.parse(left.filedAt)).slice(0, 10);
  return {
    issuer: { ...issuer, name: typeof submissions.name === "string" ? submissions.name.replace(/\s+/gu, " ").trim().slice(0, 180) : issuer.name },
    filings,
  };
}

function normalizeIssuerName(value: string) {
  const tokens = value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  while (tokens.length && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

async function readBoundedBody(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("SEC EDGAR returned an oversized response.");
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > limit) throw new Error("SEC EDGAR returned an oversized response.");
  return body;
}

function parseJson<T>(raw: string): T {
  try { return JSON.parse(raw) as T; } catch { throw new Error("SEC EDGAR returned invalid JSON."); }
}

function upstreamError(status: number) {
  return new Error(status === 429
    ? "SEC EDGAR fair-access limit reached. Try again later."
    : "SEC EDGAR is temporarily unavailable.");
}
