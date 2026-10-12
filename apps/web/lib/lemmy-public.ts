import { clipPublicExcerpt } from "./clip-public-excerpt";

export type LemmyInstance = "lemmy.world" | "discuss.tchncs.de" | "feddit.org" | "jlai.lu" | "sopuli.xyz" | "sh.itjust.works";

export const LEMMY_INSTANCES: readonly {
  host: LemmyInstance;
  label: string;
  languages: string;
  legalUrl: string;
  privacyUrl: string;
}[] = [
  { host: "lemmy.world", label: "lemmy.world", languages: "Mixed / English", legalUrl: "https://legal.lemmy.world/tos/", privacyUrl: "https://legal.lemmy.world/privacy-policy/" },
  { host: "discuss.tchncs.de", label: "discuss.tchncs.de", languages: "German / English", legalUrl: "https://discuss.tchncs.de/legal", privacyUrl: "https://tchncs.de/privacy" },
  { host: "feddit.org", label: "feddit.org · German/English community", languages: "German / English", legalUrl: "https://feddit.org/legal", privacyUrl: "https://wiki.fediverse.foundation/books/fediverse-foundation-announcements/page/data-protection-policy" },
  { host: "jlai.lu", label: "jlai.lu · French-speaking community", languages: "French", legalUrl: "https://jlai.lu/post/5", privacyUrl: "https://jlai.lu/legal" },
  { host: "sopuli.xyz", label: "Sopuli · Finnish / English community", languages: "Finnish / English", legalUrl: "https://sopuli.xyz/legal", privacyUrl: "https://sopuli.xyz/legal" },
  { host: "sh.itjust.works", label: "sh.itjust.works · Canadian English / French community", languages: "English / French", legalUrl: "https://sh.itjust.works/legal", privacyUrl: "https://sh.itjust.works/legal" },
];

export type LemmyPost = {
  id: string;
  url: string;
  title: string;
  publishedAt: string;
  author: string;
  authorUrl: string | null;
  community: string;
  languageId: number | null;
  /** The API's outgoing attachment field, independent of URLs appearing in the body. */
  linkedContent: boolean;
  /** Short, visitor-only excerpt; omitted when a citation is selected. */
  transientPreview?: string;
};

export type LemmyListingType = "all" | "local";

export type LemmyView = {
  host: LemmyInstance;
  query: string;
  returnedCount: number;
  posts: LemmyPost[];
  error: string | null;
};

type SearchResult = {
  posts?: Array<{
    post?: {
      id?: number;
      ap_id?: string;
      name?: string;
      body?: string;
      url?: string;
      published?: string;
      deleted?: boolean;
      removed?: boolean;
      nsfw?: boolean;
      language_id?: number;
    };
    creator?: {
      name?: string;
      actor_id?: string;
      deleted?: boolean;
      banned?: boolean;
      bot_account?: boolean;
    };
    community?: { name?: string; removed?: boolean; deleted?: boolean };
  }>;
};

type LemmySiteLanguages = {
  all_languages?: Array<{ id?: number; code?: string; name?: string }>;
};

/** Resolve language IDs using the same instance that emitted the post. IDs are not assumed portable. */
export async function getLemmyLanguageCatalog(
  host: LemmyInstance,
  fetcher: typeof fetch = fetch,
): Promise<Map<number, { code: string; name: string }> | null> {
  if (!LEMMY_INSTANCES.some((instance) => instance.host === host)) {
    throw new Error("Choose a supported public Lemmy instance.");
  }
  try {
    const response = await fetcher(`https://${host}/api/v3/site`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as LemmySiteLanguages;
    if (!Array.isArray(body.all_languages) || body.all_languages.length > 250) return null;
    const languages = new Map<number, { code: string; name: string }>();
    for (const language of body.all_languages) {
      if (
        Number.isInteger(language.id) && language.id! >= 0 &&
        typeof language.code === "string" && /^[a-z]{2,3}$/iu.test(language.code) &&
        typeof language.name === "string" && language.name.length <= 80
      ) {
        languages.set(language.id!, { code: language.code.toLocaleLowerCase(), name: language.name });
      }
    }
    return languages.size ? languages : null;
  } catch {
    // Language labels improve filtering but must never take down an otherwise healthy post search.
    return null;
  }
}

const MAX_RESULTS = 50;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Search one public Lemmy instance; post text is returned only for transient browser review. */
export async function searchLemmyPosts(
  query: string,
  host: LemmyInstance,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  listingType: LemmyListingType = "all",
): Promise<LemmyPost[]> {
  return (await searchLemmyPostPage(query, host, fetcher, now, listingType)).posts;
}

/** Keep raw response and safety-filter counts distinct; a malformed API response is not zero results. */
export async function searchLemmyPostPage(
  query: string,
  host: LemmyInstance,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  listingType: LemmyListingType = "all",
): Promise<{ posts: LemmyPost[]; returnedCount: number; excludedCount: number }> {
  const term = query.trim();
  if (term.length < 2 || term.length > 100) {
    throw new Error("Enter a search phrase with 2–100 characters.");
  }
  if (!LEMMY_INSTANCES.some((instance) => instance.host === host)) {
    throw new Error("Choose a supported public Lemmy instance.");
  }
  if (listingType !== "all" && listingType !== "local") throw new Error("Choose a supported Lemmy listing type.");

  const endpoint = new URL(`https://${host}/api/v3/search`);
  endpoint.search = new URLSearchParams({
    q: term,
    type_: "Posts",
    sort: "New",
    limit: String(MAX_RESULTS),
    // Lemmy serializes this API enum in PascalCase; lowercase values return 400.
    listing_type: listingType === "local" ? "Local" : "All",
  }).toString();
  const response = await fetcher(endpoint, { headers: { accept: "application/json" } });
  if (response.status === 401 || response.status === 403) {
    throw new Error("This instance does not permit public search. No login or workaround is attempted.");
  }
  if (response.status === 429) throw new Error("This instance is rate-limiting requests. Try again later.");
  if (!response.ok) throw new Error("Public forum search is temporarily unavailable on this instance.");

  const body = (await response.json()) as SearchResult;
  if (!body || !Array.isArray(body.posts)) throw new Error("This instance returned an unrecognized post-search response; no empty-search inference is made.");
  if (body.posts.length > MAX_RESULTS) throw new Error("This instance exceeded the bounded post-search limit; no oversized response is displayed.");
  const minTime = now - MAX_AGE_MS;
  const posts: LemmyPost[] = body.posts.flatMap((view) => {
    if (!view || typeof view !== "object") return [];
    const { post, creator, community } = view;
    const id = post?.id;
    const title = typeof post?.name === "string" ? post.name.trim() : "";
    const url = safeHttpsUrl(post?.ap_id);
    const publishedAt = typeof post?.published === "string" ? new Date(post.published) : null;
    const author = typeof creator?.name === "string" ? creator.name.trim() : "";
    if (
      !post || !Number.isSafeInteger(id) || id! <= 0 || !title || !url || !publishedAt || !Number.isFinite(publishedAt.getTime()) ||
      publishedAt.getTime() < minTime || publishedAt.getTime() > now ||
      post?.deleted || post?.removed || post?.nsfw || creator?.deleted || creator?.banned || creator?.bot_account ||
      community?.deleted || community?.removed || !author || typeof community?.name !== "string" || !community.name.trim() ||
      (post.url != null && typeof post.url !== "string")
    ) return [];
    return [{
      id: String(id),
      url,
      title: clipPublicExcerpt(title, 300),
      publishedAt: publishedAt.toISOString(),
      author,
      authorUrl: safeHttpsUrl(creator?.actor_id),
      community: community.name,
      languageId: Number.isInteger(post.language_id) ? post.language_id! : null,
      // Retain only the flag, not the attachment URL. It may point to reporting,
      // an image, or another outside resource even when the text contains no link.
      linkedContent: typeof post.url === "string" && post.url.trim().length > 0,
      ...(typeof post.body === "string" && post.body.trim()
        ? { transientPreview: clipPublicExcerpt(post.body.trim(), 1200) }
        : {}),
    }];
  });
  return { posts, returnedCount: body.posts.length, excludedCount: body.posts.length - posts.length };
}

/** Keep each instance's incomplete federated index visible as its own view. */
export async function compareLemmyInstances(
  queryOrQueries: string | readonly { host: LemmyInstance; query: string }[],
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  hosts: readonly LemmyInstance[] = LEMMY_INSTANCES.map(({ host }) => host),
): Promise<LemmyView[]> {
  const uniqueHosts = [...new Set(hosts)];
  if (!uniqueHosts.length || uniqueHosts.some((host) => !LEMMY_INSTANCES.some((item) => item.host === host))) {
    throw new Error("Choose one or more supported public Lemmy instances.");
  }
  const queryByHost = new Map<LemmyInstance, string>();
  if (typeof queryOrQueries === "string") {
    for (const host of uniqueHosts) queryByHost.set(host, queryOrQueries);
  } else {
    for (const item of queryOrQueries) {
      if (!LEMMY_INSTANCES.some((instance) => instance.host === item.host))
        throw new Error("Choose a supported public Lemmy instance.");
      if (queryByHost.has(item.host)) throw new Error("Each Lemmy instance can be searched only once.");
      const term = item.query.trim();
      if (term.length < 2 || term.length > 100)
        throw new Error("Each search phrase must have 2–100 characters.");
      queryByHost.set(item.host, term);
    }
    if (uniqueHosts.some((host) => !queryByHost.has(host)) || queryByHost.size !== uniqueHosts.length)
      throw new Error("Provide exactly one search phrase for every selected Lemmy instance.");
  }
  return Promise.all(uniqueHosts.map(async (host) => {
    const query = queryByHost.get(host)!;
    try {
      const posts = await searchLemmyPosts(query, host, fetcher, now);
      return { host, query, returnedCount: posts.length, posts, error: null };
    } catch (cause) {
      return {
        host,
        query,
        returnedCount: 0,
        posts: [],
        error: cause instanceof Error ? cause.message : "This instance is temporarily unavailable.",
      };
    }
  }));
}

function safeHttpsUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
