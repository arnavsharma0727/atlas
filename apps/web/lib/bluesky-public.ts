import { clipPublicExcerpt } from "./clip-public-excerpt";
import { atprotoPostTime } from "./atproto-post-time";

/** Transient search against Bluesky's public AppView; snippets are for browser-only review, never citations. */
export type BlueskyPostCitation = {
  uri: string;
  url: string;
  title: string;
  authorHandle: string;
  publishedAt: string;
  language: string;
  transientPreview?: string;
  contentWarning?: string;
  /** Exact normalized text matches in this response are represented once. */
  duplicateCount: number;
  /** Link facets and external-card metadata can contain links absent from visible text. */
  linkedContent: boolean;
};

type SearchResponse = {
  posts?: Array<{
    uri?: string;
    record?: { text?: string; createdAt?: string; langs?: string[]; facets?: unknown; embed?: unknown };
    embed?: unknown;
    author?: { handle?: string };
    labels?: Array<{ val?: string }>;
  }>;
};

// The AppView lexicon permits 100 items. A single bounded page gives sparse
// language lenses a better chance without cursor walking or collecting a feed.
const MAX_RESULTS = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function searchBlueskyPosts(
  query: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  options: { language?: string } = {},
): Promise<BlueskyPostCitation[]> {
  const term = query.trim();
  if (term.length < 2 || term.length > 100) throw new Error("Enter a search phrase with 2–100 characters.");
  if (options.language && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(options.language)) throw new Error("Use a valid provider language filter.");
  // Search itself is currently served unauthenticated from api.bsky.app;
  // public.api.bsky.app returns 403 for this method.
  const endpoint = new URL("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
  endpoint.search = new URLSearchParams({ q: term, limit: String(MAX_RESULTS), sort: "latest" }).toString();
  if (options.language) endpoint.searchParams.set("lang", options.language);
  const response = await fetcher(endpoint, { headers: { accept: "application/json" } });
  if (response.status === 429) throw new Error("Bluesky is rate-limiting public search. Try again later.");
  if (!response.ok) throw new Error("Bluesky public search is temporarily unavailable.");
  const body = await response.json() as SearchResponse;
  if (!body || !Array.isArray(body.posts)) throw new Error("Bluesky returned an unrecognized search response; no empty-search inference is made.");
  if (body.posts.length > MAX_RESULTS) throw new Error("Bluesky exceeded the bounded search limit; no oversized response is displayed.");
  const minTime = now - MAX_AGE_MS;
  const unique = new Map<string, BlueskyPostCitation>();
  for (const post of body.posts) {
    if (!post || typeof post !== "object") continue;
    const uri = post.uri;
    const handle = post.author?.handle?.trim();
    const time = atprotoPostTime(post.record?.createdAt);
    const text = post.record?.text?.replace(/\s+/g, " ").trim();
    if (!uri || !handle || !text || time === null || time < minTime || time > now) continue;
    const match = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
    if (!match) continue;
    const url = `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(match[2])}`;
    const labels = (post.labels ?? []).map(({ val }) => val).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const contentWarning = labels.length ? `Provider label${labels.length === 1 ? "" : "s"}: ${labels.join(", ")}. Preview withheld.` : undefined;
    const textKey = text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const linkedContent = hasExternalEmbed(post.embed) || hasExternalEmbed(post.record?.embed) ||
      hasLinkFacet(post.record?.facets) || /(?:https?:\/\/|www\.)/iu.test(text);
    const duplicate = unique.get(textKey);
    if (duplicate) {
      duplicate.duplicateCount += 1;
      // Repeated text with a link must not inherit an unlinked copy's eligibility.
      duplicate.linkedContent ||= linkedContent;
      if (contentWarning) {
        duplicate.contentWarning = duplicate.contentWarning
          ? `${duplicate.contentWarning} ${contentWarning}`
          : contentWarning;
        delete duplicate.transientPreview;
      }
      continue;
    }
    unique.set(textKey, {
      uri,
      url,
      // Content is never returned to callers or retained in the brief.
      title: `Public Bluesky post by @${handle}`,
      authorHandle: handle,
      publishedAt: new Date(time).toISOString(),
      language: post.record?.langs?.[0] ?? "not provided",
      duplicateCount: 1,
      linkedContent,
      // Displayed only in live browser results; callers strip this before selecting a citation.
      ...(!contentWarning ? { transientPreview: clipPublicExcerpt(text, 300) } : {}),
      ...(contentWarning ? { contentWarning } : {}),
    });
  }
  return [...unique.values()];
}

function hasExternalEmbed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const embed = value as Record<string, unknown>;
  if (isExternalType(embed.$type)) return true;
  if (embed.$type !== "app.bsky.embed.recordWithMedia" && embed.$type !== "app.bsky.embed.recordWithMedia#view") return false;
  const media = embed.media;
  return !!media && typeof media === "object" &&
    isExternalType((media as Record<string, unknown>).$type);
}

function isExternalType(value: unknown): boolean {
  // The current lexicon also defines article/gallery/livestream external views.
  return typeof value === "string" && (value === "app.bsky.embed.external" || value.startsWith("app.bsky.embed.external#"));
}

function hasLinkFacet(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length > 100) return true;
  return value.some((facet: unknown) => {
    if (!facet || typeof facet !== "object") return false;
    const features = (facet as Record<string, unknown>).features;
    return Array.isArray(features) && features.some((feature: unknown) =>
      !!feature && typeof feature === "object" && (feature as Record<string, unknown>).$type === "app.bsky.richtext.facet#link",
    );
  });
}
