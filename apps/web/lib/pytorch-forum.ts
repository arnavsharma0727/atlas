import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { withFetchTimeout } from "./fetch-with-timeout";
import { publicationTimestampUTC } from "./publication-date";
import { matchesScholarlyTitle } from "./scholarly-title-match";
import type { ResearchEvidence } from "./research-brief";

const HOST = "https://discuss.pytorch.org";
export const PYTORCH_WINDOW = "Latest 30 active public topics only · exact title-word matches · original posts within 30 days · at most 3 topic reads · no forum search or pagination";
export const PYTORCH_COVERAGE = "Technical deployment/problem reports, not investor sentiment. Language and contributor geography are not reported. Excluded from AI overviews. Old topics bumped by recent replies are not current original posts; replies are not sampled. No matches in this small feed do not establish absence.";

/** Conservative English scope, not an automatic translation or company-to-product expansion. */
export function pytorchAppliesToQuery(query: string) {
  return /\b(?:pytorch|libtorch|torchscript|gpu|gpus|cuda|rocm|nvidia|triton|tensorrt|onnx|inference)\b/iu.test(query.normalize("NFKC"));
}

export type PytorchSample = {
  evidence: ResearchEvidence[];
  feedCount: number;
  matchingTopics: number;
  failedTopics: number;
  excludedTopics: number;
  retrievedAt: string;
};
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}
function recent(value: unknown, now: number) {
  const stamp = typeof value === "string" ? publicationTimestampUTC(value) : null;
  return stamp !== null && stamp <= now && stamp >= now - 30 * 86400000;
}

/** Only unquoted prose. Code, artifacts, quoted material, link previews and media are not reused. */
export function pytorchProse(html: string): string {
  if (html.length > 65_536) return "";
  type Node = DefaultTreeAdapterMap["node"];
  const stack: Node[] = [...parseFragment(html).childNodes].reverse();
  const text: string[] = [];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++visited > 5000) return "";
    if ("tagName" in node && ["pre", "code", "blockquote", "aside", "script", "style", "template", "a", "img", "iframe", "svg", "video", "audio"].includes(node.tagName)) {
      text.push(" ");
      continue;
    }
    if ("value" in node && node.nodeName === "#text") text.push(node.value);
    if ("tagName" in node && ["p", "div", "br", "li"].includes(node.tagName)) text.push(" ");
    if ("childNodes" in node) stack.push(...[...node.childNodes].reverse());
  }
  return text.join("").replace(/\s+/gu, " ").trim().slice(0, 900);
}

/** Fixed host/path allowlist: never invoke the robots-disallowed /search endpoint. */
export async function searchPytorchForum(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<PytorchSample> {
  const query = input.trim();
  if (query.length < 2 || query.length > 100 || !pytorchAppliesToQuery(query)) throw new Error("PyTorch is limited to explicit GPU/inference/framework queries.");
  const boundedFetch = withFetchTimeout(fetcher, 6000, 1_500_000);
  const deadline = AbortSignal.timeout(7000);
  let retrievedAt = Date.now();
  const read = async (path: string): Promise<ObjectValue> => {
    const response = await boundedFetch(`${HOST}${path}`, {
      headers: { accept: "application/json", "user-agent": "Atlas/1.0 (https://signal-scout-xi-ruby.vercel.app/sources)" },
      cache: "no-store", redirect: "error", signal: deadline,
    });
    if (!response.ok) throw new Error(response.status === 429 ? "PyTorch public feed is rate-limited." : "PyTorch public feed is unavailable.");
    const fetched = publicationTimestampUTC(response.headers.get("x-atlas-provider-fetched-at") ?? "");
    if (fetched !== null && fetched <= Date.now()) retrievedAt = Math.min(retrievedAt, fetched);
    const payload = object(await response.json());
    if (!payload) throw new Error("PyTorch returned an unexpected response.");
    return payload;
  };
  const payload = await read("/latest.json");
  const topics = object(payload.topic_list)?.topics;
  if (!Array.isArray(topics)) throw new Error("PyTorch returned an unexpected topic list.");
  const feed = topics.slice(0, 30);
  const seen = new Set<number>();
  const matches = feed.flatMap((raw) => {
    const topic = object(raw);
    if (!topic || !Number.isSafeInteger(topic.id) || (topic.id as number) <= 0 || seen.has(topic.id as number) || topic.visible !== true || topic.archetype !== "regular" || !recent(topic.created_at, now) || typeof topic.title !== "string" || topic.title.length > 300 || !matchesScholarlyTitle(topic.title, query)) return [];
    seen.add(topic.id as number);
    return [{ id: topic.id as number, title: topic.title }];
  });
  let failedTopics = 0;
  let excludedTopics = 0;
  // Sequential, strictly bounded reads: no feed/page/stream crawling.
  const evidence: ResearchEvidence[] = [];
  for (const topic of matches.slice(0, 3)) {
    let detail: ObjectValue;
    try { detail = await read(`/t/${topic.id}.json`); }
    catch { failedTopics++; continue; }
    const posts = object(detail.post_stream)?.posts;
    const post = Array.isArray(posts) ? posts.map(object).find((p) => p?.post_number === 1) : null;
    if (detail.id !== topic.id || detail.title !== topic.title || detail.visible !== true || detail.archetype !== "regular" || detail.deleted_at || !post || post.topic_id !== topic.id || post.post_type !== 1 || post.hidden !== false || post.deleted_at || !recent(post.created_at, now) || typeof post.username !== "string" || !/^[\w.-]{1,60}$/u.test(post.username) || typeof post.cooked !== "string") {
      excludedTopics++; continue;
    }
    const prose = pytorchProse(post.cooked);
    if (prose.length < 40 || /\b(?:all rights reserved|not for redistribution|licensed under|copyright)\b/iu.test(prose)) { excludedTopics++; continue; }
    evidence.push({
      id: `pytorch:${topic.id}:1`, title: topic.title, url: `${HOST}/t/${topic.id}/1`,
      source: "PyTorch Forums · latest-topic sample", evidenceClass: "community forum",
      language: "Not reported", timeLabel: "Original post created", timeValue: post.created_at as string,
      transientPreview: prose, summaryEligible: false,
      attribution: post.username, attributionUrl: `${HOST}/u/${encodeURIComponent(post.username)}`,
      licenseName: "CC BY 4.0 · general forum prose; exceptions apply", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      context: "Excerpt shortened and HTML formatting removed; code, quotations, links and media omitted. General prose reuse follows the forum-linked LF terms, except separately licensed or third-party material. Technical self-reports are unverified and may be promotional; not a national or representative sample. Excluded from AI overview.",
      sourceOperatorKey: "pytorch", sourceOperatorLabel: "PyTorch Forums",
    });
  }
  return { evidence, feedCount: feed.length, matchingTopics: matches.length, failedTopics, excludedTopics, retrievedAt: new Date(retrievedAt).toISOString() };
}
