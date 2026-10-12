export const DISCUSSION_COMMUNITIES = [
  { site: "economics", label: "Economics Stack Exchange", language: "English" },
  { site: "quant", label: "Quantitative Finance Stack Exchange", language: "English" },
  { site: "money", label: "Personal Finance & Money", language: "English" },
  { site: "ai", label: "Artificial Intelligence", language: "English" },
  { site: "datascience", label: "Data Science", language: "English" },
  { site: "security", label: "Information Security", language: "English" },
  { site: "es.stackoverflow", label: "Stack Overflow en español", language: "Spanish" },
  { site: "pt.stackoverflow", label: "Stack Overflow em Português", language: "Portuguese" },
  { site: "ja.stackoverflow", label: "スタック・オーバーフロー", language: "Japanese" },
  { site: "ru.stackoverflow", label: "Stack Overflow на русском", language: "Russian" },
  { site: "literature", label: "Literature Stack Exchange", language: "English" },
  { site: "politics", label: "Politics Stack Exchange", language: "English" },
  { site: "law", label: "Law Stack Exchange", language: "English" },
] as const;

export type LiveDiscussionItem = {
  id: number;
  title: string;
  url: string;
  createdAt: string;
  tags: string[];
  author: string;
  authorUrl: string;
  community: string;
  language: string;
  licenseUrl: string;
  answerExcerpt?: string;
  answerUrl?: string;
  answerAuthor?: string;
  answerAuthorUrl?: string;
  answerCreatedAt?: string;
  answerLookupIssue?: string;
};

const LICENSE = "CC BY-SA 4.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const API = "https://api.stackexchange.com/2.3/search/advanced";
const ANSWERS_API = "https://api.stackexchange.com/2.3/questions";
let stackExchangeQuotaRemaining: number | null = null;
let stackExchangeSearchBackoffUntil = 0;
let stackExchangeAnswersBackoffUntil = 0;

type ApiResponse = {
  quota_remaining?: number;
  backoff?: number;
  error_id?: number;
  error_message?: string;
  items?: Array<{
    question_id?: number;
    title?: string;
    link?: string;
    creation_date?: number;
    content_license?: string;
    tags?: string[];
    owner?: { display_name?: string; link?: string };
  }>;
};

type AnswersResponse = {
  quota_remaining?: number;
  backoff?: number;
  error_id?: number;
  error_message?: string;
  items?: Array<{
    answer_id?: number;
    question_id?: number;
    link?: string;
    body?: string;
    creation_date?: number;
    content_license?: string;
    owner?: { display_name?: string; link?: string };
  }>;
};

/** Search one selected Stack Exchange community; only explicitly licensed items are returned. */
export async function searchLiveDiscussion(
  topic: string,
  site: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<LiveDiscussionItem[]> {
  const query = topic.trim();
  const community = DISCUSSION_COMMUNITIES.find((item) => item.site === site);
  if (query.length < 3 || query.length > 80 || !community) {
    throw new Error("Enter a topic of 3–80 characters and choose a listed community.");
  }
  if (now < stackExchangeSearchBackoffUntil) {
    const seconds = Math.ceil((stackExchangeSearchBackoffUntil - now) / 1000);
    throw new Error(`Stack Exchange requested a backoff. Atlas will wait ${seconds} seconds before another request.`);
  }
  if (stackExchangeQuotaRemaining === 0) {
    throw new Error("Stack Exchange reports no shared API quota remaining. Try again after its quota resets.");
  }

  const params = new URLSearchParams({
    order: "desc",
    sort: "relevance",
    site: community.site,
    title: query,
    pagesize: "25",
    fromdate: String(Math.floor((now - 30 * 24 * 60 * 60 * 1000) / 1000)),
    todate: String(Math.floor(now / 1000)),
    filter: "default",
    origin: "*",
  });
  const response = await fetcher(`${API}?${params}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as ApiResponse | null;
    recordThrottle(errorBody, now, "search");
    if (response.status === 429) throw new Error("Stack Exchange is rate-limiting requests. Try again later.");
    throw new Error("The live source is temporarily unavailable. Try again later.");
  }

  const body = (await response.json()) as ApiResponse;
  recordThrottle(body, now, "search");
  if (body.error_id || !Array.isArray(body.items)) {
    throw new Error("Stack Exchange returned an API error. This source is unavailable for the current search.");
  }
  const oldest = now - 30 * 24 * 60 * 60 * 1000;
  const expectedHost = site.endsWith(".stackoverflow")
    ? `${site}.com`
    : `${site}.stackexchange.com`;
  const questions = (body.items ?? []).flatMap((item) => {
    const createdAt = typeof item.creation_date === "number" ? item.creation_date * 1000 : NaN;
    let link: URL;
    let authorLink: URL;
    try {
      link = new URL(typeof item.link === "string" ? item.link : "");
      authorLink = new URL(typeof item.owner?.link === "string" ? item.owner.link : "");
    } catch {
      return [];
    }
    if (
      item.content_license !== LICENSE ||
      typeof item.question_id !== "number" ||
      typeof item.title !== "string" ||
      link.protocol !== "https:" || link.hostname !== expectedHost ||
      authorLink.protocol !== "https:" || authorLink.hostname !== expectedHost ||
      !Number.isFinite(createdAt) || createdAt < oldest || createdAt > now ||
      !matchesEveryMeaningfulTerm(decodeEntities(item.title), query) ||
      typeof item.owner?.display_name !== "string" ||
      typeof item.owner.link !== "string"
    ) return [];

    return [{
      id: item.question_id,
      title: decodeEntities(item.title),
      url: link.toString(),
      createdAt: new Date(createdAt).toISOString(),
      tags: (item.tags ?? []).filter((tag): tag is string => typeof tag === "string"),
      author: item.owner.display_name,
      authorUrl: authorLink.toString(),
      community: community.label,
      language: community.language,
      licenseUrl: LICENSE_URL,
    }];
  });

  // One batched answer lookup adds useful expert context without turning the
  // title search into an unbounded crawl. Answer text is display-only: the
  // Atlas summary selector explicitly excludes this CC BY-SA material.
  const questionIds = questions.slice(0, 8).map(({ id }) => id);
  if (!questionIds.length) return questions;
  if (stackExchangeQuotaRemaining === 0) {
    return questions.map((question) => ({ ...question, answerLookupIssue: "Stack Exchange reports no shared API quota remaining for answer lookup; question titles may still be shown." }));
  }
  if (now < stackExchangeAnswersBackoffUntil) {
    return questions.map((question) => ({ ...question, answerLookupIssue: "Stack Exchange requested an answer-endpoint backoff; question titles may still be shown." }));
  }
  const answersUrl = new URL(`${ANSWERS_API}/${questionIds.join(";")}/answers`);
  answersUrl.search = new URLSearchParams({
    order: "desc",
    sort: "votes",
    site: community.site,
    pagesize: "25",
    fromdate: String(Math.floor(oldest / 1000)),
    todate: String(Math.floor(now / 1000)),
    filter: "withbody",
    origin: "*",
  }).toString();

  let answerBody: AnswersResponse;
  try {
    const answerResponse = await fetcher(answersUrl.toString(), {
      headers: { accept: "application/json" },
    });
    if (!answerResponse.ok) {
      const errorBody = await answerResponse.json().catch(() => null) as AnswersResponse | null;
      recordThrottle(errorBody, now, "answers");
      return questions.map((question) => ({ ...question, answerLookupIssue: "Stack Exchange answer lookup was unavailable; question titles may still be shown." }));
    }
    answerBody = (await answerResponse.json()) as AnswersResponse;
  } catch {
    // Preserve the successful question search if the richer endpoint fails.
    return questions.map((question) => ({ ...question, answerLookupIssue: "Stack Exchange answer lookup was unavailable; question titles may still be shown." }));
  }
  recordThrottle(answerBody, now, "answers");
  if (answerBody.error_id || !Array.isArray(answerBody.items)) {
    return questions.map((question) => ({ ...question, answerLookupIssue: "Stack Exchange answer lookup was unavailable; question titles may still be shown." }));
  }

  const allowedQuestionIds = new Set(questionIds);
  const answerCounts = new Map<number, number>();
  const answersByQuestion = new Map<number, Array<{
    answerExcerpt: string; answerUrl: string; answerAuthor: string; answerAuthorUrl: string; answerCreatedAt: string;
  }>>();
  for (const answer of answerBody.items ?? []) {
    const createdAtMs = typeof answer.creation_date === "number" ? answer.creation_date * 1000 : NaN;
    const question = questions.find(({ id }) => id === answer.question_id);
    if (
      !question || !allowedQuestionIds.has(answer.question_id!) || answer.content_license !== LICENSE ||
      typeof answer.answer_id !== "number" || typeof answer.body !== "string" ||
      !Number.isFinite(createdAtMs) || createdAtMs < oldest || createdAtMs > now ||
      typeof answer.owner?.display_name !== "string" || typeof answer.owner.link !== "string" ||
      !matchesEveryMeaningfulTerm(htmlToPlainText(answer.body), query)
    ) continue;
    let answerLink: URL;
    let profileLink: URL;
    try {
      answerLink = new URL(typeof answer.link === "string" ? answer.link : "");
      profileLink = new URL(answer.owner.link);
    } catch {
      continue;
    }
    if (answerLink.protocol !== "https:" || answerLink.hostname !== expectedHost ||
      profileLink.protocol !== "https:" || profileLink.hostname !== expectedHost) continue;
    const count = answerCounts.get(answer.question_id!) ?? 0;
    if (count >= 1) continue;
    const excerpt = htmlToPlainText(answer.body);
    if (excerpt.length < 60) continue;
    answerCounts.set(answer.question_id!, count + 1);
    const answers = answersByQuestion.get(answer.question_id!) ?? [];
    answers.push({
      answerExcerpt: excerpt.slice(0, 420).trimEnd(),
      answerUrl: answerLink.toString(),
      answerAuthor: answer.owner.display_name,
      answerAuthorUrl: profileLink.toString(),
      answerCreatedAt: new Date(createdAtMs).toISOString(),
    });
    answersByQuestion.set(answer.question_id!, answers);
  }
  return questions.map((question) => ({ ...question, ...answersByQuestion.get(question.id)?.[0] }));
}

export function getStackExchangeThrottleStatus() {
  const searchBackoffSeconds = Math.max(0, Math.ceil((stackExchangeSearchBackoffUntil - Date.now()) / 1000));
  const answersBackoffSeconds = Math.max(0, Math.ceil((stackExchangeAnswersBackoffUntil - Date.now()) / 1000));
  return {
    quotaRemaining: stackExchangeQuotaRemaining,
    backoffSeconds: Math.max(searchBackoffSeconds, answersBackoffSeconds),
    searchBackoffSeconds,
    answersBackoffSeconds,
  };
}

/** Reset in-memory provider state after isolated adapter tests. */
export function resetStackExchangeThrottleStatus() {
  stackExchangeQuotaRemaining = null;
  stackExchangeSearchBackoffUntil = 0;
  stackExchangeAnswersBackoffUntil = 0;
}

function recordThrottle(body: { quota_remaining?: number; backoff?: number } | null, now: number, method: "search" | "answers") {
  if (!body) return;
  if (typeof body.quota_remaining === "number" && Number.isInteger(body.quota_remaining) && body.quota_remaining >= 0) {
    stackExchangeQuotaRemaining = body.quota_remaining;
  }
  if (typeof body.backoff === "number" && Number.isFinite(body.backoff) && body.backoff > 0) {
    if (method === "search") {
      stackExchangeSearchBackoffUntil = Math.max(stackExchangeSearchBackoffUntil, now + Math.ceil(body.backoff) * 1000);
    } else {
      stackExchangeAnswersBackoffUntil = Math.max(stackExchangeAnswersBackoffUntil, now + Math.ceil(body.backoff) * 1000);
    }
  }
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"]);

function matchesEveryMeaningfulTerm(title: string, query: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
  const terms = normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = terms.filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  const normalizedTitle = normalize(title);
  const quoted = query.trim().match(/^"(.+)"$/u)?.[1];
  if (quoted) {
    const normalizePhrase = (value: string) => normalize(value).match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
    return normalizePhrase(normalizedTitle).includes(normalizePhrase(quoted));
  }
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query)) {
    return meaningful.length > 0 && meaningful.every((term) => normalizedTitle.includes(term));
  }
  if (meaningful.length === 0) return normalizedTitle.includes(normalize(query));
  const titleTerms = new Set(normalizedTitle.match(/[\p{L}\p{N}]+/gu) ?? []);
  return meaningful.every((term) => titleTerms.has(term));
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“");
}

function safeCodePoint(code: number) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

/** Convert API-provided HTML to inert, compact display text; never render markup. */
function htmlToPlainText(value: string) {
  return decodeEntities(value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6]|br|pre|code)\s*>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
