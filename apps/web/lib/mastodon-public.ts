import { isValidTopicHashtag } from "./topic-hashtags";

export type MastodonPublicPost = {
  id: string;
  url: string;
  createdAt: string;
  contentHtml: string;
  contentWarning: string;
  language: string | null;
  authorName: string;
  authorHandle: string;
  authorUrl: string;
  originServer: string;
  accountMarkedAutomated: boolean;
};

/** Convert provider HTML to safe plain text for transient React rendering. */
export function mastodonHtmlToTransientText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => decodeCodePoint(parseInt(code, 16)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
      "&apos;": "'", "&#39;": "'", "&nbsp;": " ",
    }[entity.toLowerCase()] ?? entity))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1200);
}

function decodeCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value)
    : "�";
}

export type MastodonServerView = {
  host: MastodonInstance;
  tag: string;
  returnedCount: number;
  error: string | null;
};

export type MastodonSample = {
  post: MastodonPublicPost;
  seenVia: MastodonInstance[];
  searches: Array<{ host: MastodonInstance; tag: string }>;
};

export type MastodonInstanceQuery = { host: MastodonInstance; tag: string };

export type MastodonTrendingTag = { name: string; url: string };
export type MastodonTrendView = {
  host: MastodonInstance;
  tags: MastodonTrendingTag[];
  error: string | null;
};

type ApiPost = {
  id?: string;
  url?: string | null;
  created_at?: string;
  visibility?: string;
  content?: string;
  spoiler_text?: string;
  language?: string | null;
  reblog?: unknown;
  account?: {
    display_name?: string;
    acct?: string;
    url?: string;
    bot?: boolean;
  };
};

type ApiTag = { name?: unknown };

export const MASTODON_INSTANCES = [
  { host: "mastodon.social", label: "mastodon.social" },
  { host: "mastodon.online", label: "mastodon.online" },
  { host: "mstdn.jp", label: "mstdn.jp" },
  { host: "mastodon.world", label: "mastodon.world" },
  { host: "town.voyager.blue", label: "town.voyager.blue · Korean-language community" },
  { host: "troet.cafe", label: "troet.cafe · German-language community" },
  { host: "piaille.fr", label: "piaille.fr · French-language community" },
  { host: "masto.es", label: "masto.es · Spanish-language community" },
  { host: "organica.social", label: "organica.social · Brazilian Portuguese community" },
] as const;
export type MastodonInstance = (typeof MASTODON_INSTANCES)[number]["host"];
export const MASTODON_INSTANCE_HOSTS: ReadonlySet<string> = new Set(MASTODON_INSTANCES.map(({ host }) => host));
const MAX_POST_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Read the instance's public trending-tag suggestions; no posts or trend data are retained. */
export async function fetchTrendingHashtags(
  instance: MastodonInstance,
  fetcher: typeof fetch = fetch,
): Promise<MastodonTrendingTag[]> {
  if (!MASTODON_INSTANCES.some((candidate) => candidate.host === instance)) {
    throw new Error("Choose a supported public Mastodon server.");
  }
  const response = await fetcher(`https://${instance}/api/v1/trends/tags?limit=10`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("This instance does not expose public trend suggestions. No login or workaround is attempted.");
  }
  if (response.status === 429) {
    throw new Error("This instance is rate-limiting requests. Try again later.");
  }
  if (!response.ok) throw new Error("Trend suggestions are temporarily unavailable on this instance.");

  const body = (await response.json()) as ApiTag[];
  if (!Array.isArray(body)) return [];
  return body.flatMap((tag) => {
    if (typeof tag.name !== "string" || !isValidTopicHashtag(tag.name)) return [];
    return [{
      name: tag.name,
      url: `https://${instance}/tags/${encodeURIComponent(tag.name)}`,
    }];
  });
}

/** Keep each server's own trend list separate; Mastodon trend scores are instance-specific. */
export async function compareTrendingHashtags(
  fetcher: typeof fetch = fetch,
  instances: readonly MastodonInstance[] = MASTODON_INSTANCES.map(({ host }) => host),
): Promise<MastodonTrendView[]> {
  const uniqueInstances = [...new Set(instances)];
  if (!uniqueInstances.length || uniqueInstances.some(
    (instance) => !MASTODON_INSTANCES.some((candidate) => candidate.host === instance),
  )) {
    throw new Error("Choose one or more supported public Mastodon servers.");
  }
  return Promise.all(uniqueInstances.map(async (host) => {
    try {
      return { host, tags: await fetchTrendingHashtags(host, fetcher), error: null };
    } catch (cause) {
      return {
        host,
        tags: [],
        error: cause instanceof Error ? cause.message : "Trend suggestions are temporarily unavailable.",
      };
    }
  }));
}

/** Read one public hashtag timeline directly from Mastodon; never persists posts. */
export async function searchPublicHashtag(
  input: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  instance: MastodonInstance = "mastodon.social",
  localOnly = false,
): Promise<MastodonPublicPost[]> {
  const hashtag = input.trim().replace(/^#+/, "");
  if (!isValidTopicHashtag(hashtag)) {
    throw new Error("Enter a hashtag with 1–50 letters, numbers, underscores, or hyphens.");
  }
  if (!MASTODON_INSTANCES.some((candidate) => candidate.host === instance)) {
    throw new Error("Choose a supported public Mastodon server.");
  }

  const endpoint = new URL(`https://${instance}/api/v1/timelines/tag/${encodeURIComponent(hashtag)}`);
  endpoint.searchParams.set("limit", "20");
  if (localOnly) endpoint.searchParams.set("local", "true");
  const response = await fetcher(
    endpoint,
    { headers: { accept: "application/json" } },
  );
  if (response.status === 401) {
    throw new Error("This instance no longer allows public timeline access. No login or workaround is attempted.");
  }
  if (response.status === 404) {
    throw new Error("That hashtag is not available on this instance.");
  }
  if (response.status === 429) {
    throw new Error("Mastodon is rate-limiting requests. Try again later.");
  }
  if (!response.ok) throw new Error("The public timeline is temporarily unavailable.");

  const posts = (await response.json()) as ApiPost[];
  if (!Array.isArray(posts)) throw new Error("This instance returned an unrecognized timeline response; no empty-search inference is made.");
  if (posts.length > 20) throw new Error("This instance exceeded the bounded timeline limit; no oversized response is displayed.");

  return posts.flatMap((post) => {
    if (!post || typeof post !== "object") return [];
    const postUrl = safeHttpsUrl(post.url);
    const authorUrl = safeHttpsUrl(post.account?.url);
    const createdAt = post.created_at ? new Date(post.created_at) : null;
    const acct = post.account?.acct;
    if (
      post.visibility !== "public" ||
      post.reblog ||
      !post.id ||
      !postUrl ||
      !authorUrl ||
      !createdAt ||
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.getTime() > now ||
      now - createdAt.getTime() > MAX_POST_AGE_MS ||
      !acct ||
      typeof post.content !== "string"
    ) return [];

    return [{
      id: post.id,
      url: postUrl,
      createdAt: createdAt.toISOString(),
      contentHtml: post.content,
      contentWarning: typeof post.spoiler_text === "string" ? post.spoiler_text : "",
      language: typeof post.language === "string" ? post.language : null,
      authorName: post.account?.display_name?.trim() || acct,
      authorHandle: acct,
      authorUrl,
      originServer: new URL(postUrl).hostname,
      accountMarkedAutomated: post.account?.bot === true,
    }];
  });
}

/** Compare one bounded sample per selected instance; results are never persisted. */
export async function comparePublicHashtag(
  input: string | readonly MastodonInstanceQuery[],
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  instances: readonly MastodonInstance[] = MASTODON_INSTANCES.map(({ host }) => host),
) {
  const uniqueInstances = [...new Set(instances)];
  if (!uniqueInstances.length || uniqueInstances.some(
    (instance) => !MASTODON_INSTANCES.some((candidate) => candidate.host === instance),
  )) {
    throw new Error("Choose one or more supported public Mastodon servers.");
  }

  const tagByHost = new Map<MastodonInstance, string>();
  if (typeof input === "string") {
    for (const host of uniqueInstances) tagByHost.set(host, validateHashtag(input));
  } else {
    for (const item of input) {
      if (!MASTODON_INSTANCES.some(({ host }) => host === item.host))
        throw new Error("Choose a supported public Mastodon server.");
      if (tagByHost.has(item.host)) throw new Error("Each Mastodon server can be searched only once.");
      tagByHost.set(item.host, validateHashtag(item.tag));
    }
    if (uniqueInstances.some((host) => !tagByHost.has(host)) || tagByHost.size !== uniqueInstances.length)
      throw new Error("Provide exactly one hashtag for every selected Mastodon server.");
  }

  const results = await Promise.all(uniqueInstances.map(async (host) => {
    const tag = tagByHost.get(host)!;
    try {
      return { host, tag, posts: await searchPublicHashtag(tag, fetcher, now, host), error: null };
    } catch (cause) {
      return {
        host,
        tag,
        posts: [],
        error: cause instanceof Error ? cause.message : "This server view is temporarily unavailable.",
      };
    }
  }));
  const samples = new Map<string, MastodonSample>();
  for (const result of results) {
    for (const post of result.posts) {
      const sample = samples.get(post.url);
      if (sample) {
        sample.seenVia.push(result.host);
        sample.searches.push({ host: result.host, tag: result.tag });
      } else samples.set(post.url, {
        post,
        seenVia: [result.host],
        searches: [{ host: result.host, tag: result.tag }],
      });
    }
  }

  return {
    views: results.map(({ host, tag, posts, error }) => ({
      host,
      tag,
      returnedCount: posts.length,
      error,
    })) satisfies MastodonServerView[],
    samples: [...samples.values()],
  };
}

function validateHashtag(input: string) {
  const hashtag = input.trim().replace(/^#+/, "");
  if (!isValidTopicHashtag(hashtag))
    throw new Error("Enter a hashtag with 1–50 letters, numbers, underscores, or hyphens.");
  return hashtag;
}

function safeHttpsUrl(value: string | null | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
