import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "./fetch";
import { makeDocument } from "./normalize";
import type { Connector, ConnectorResult } from "./types";

export const THE_CONVERSATION_EDITIONS = [
  {
    code: "uk",
    label: "United Kingdom",
    language: "en",
    feed: "https://theconversation.com/uk/articles.atom",
  },
  {
    code: "ca",
    label: "Canada",
    language: "en",
    feed: "https://theconversation.com/ca/articles.atom",
  },
  {
    code: "africa",
    label: "Africa",
    language: "en",
    feed: "https://theconversation.com/africa/articles.atom",
  },
  {
    code: "nz",
    label: "New Zealand",
    language: "en",
    feed: "https://theconversation.com/nz/articles.atom",
  },
  {
    code: "au",
    label: "Australia",
    language: "en",
    feed: "https://theconversation.com/au/articles.atom",
  },
  {
    code: "us",
    label: "United States",
    language: "en",
    feed: "https://theconversation.com/us/articles.atom",
  },
] as const;

const ALLOWED_HOST = "theconversation.com";
const MAX_FEED_BYTES = 1_500_000;

/** Direct licensed Atom metadata; article body/summary text is deliberately discarded. */
export class TheConversationConnector implements Connector {
  name = "the-conversation";

  validateConfiguration() {
    return { valid: true, errors: [] };
  }

  async fetchDocuments(
    input: Parameters<Connector["fetchDocuments"]>[0],
  ): Promise<ConnectorResult> {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const documents: ReturnType<typeof makeDocument>[] = [];
    const failures: string[] = [];
    let requestsUsed = 0;
    let successfulFeeds = 0;

    for (const edition of THE_CONVERSATION_EDITIONS) {
      try {
        const response = await fetchWithRetry(edition.feed, {
          headers: { accept: "application/atom+xml, application/xml" },
        });
        requestsUsed++;
        const finalUrl = new URL(response.url || edition.feed);
        if (
          finalUrl.protocol !== "https:" ||
          finalUrl.hostname !== ALLOWED_HOST ||
          finalUrl.pathname !== new URL(edition.feed).pathname
        ) {
          failures.push(edition.code);
          continue;
        }
        const xml = await readBoundedText(response, MAX_FEED_BYTES);
        if (xml === null) {
          failures.push(edition.code);
          continue;
        }
        const parsed = parser.parse(xml) as Record<string, any>;
        const feed = parsed.feed;
        const rawEntries = feed?.entry ?? [];
        if (!feed || !feed.id || !feed.title) {
          failures.push(edition.code);
          continue;
        }
        successfulFeeds++;
        const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
        for (const entry of entries) {
          const title = typeof entry.title === "string" ? entry.title.trim() : "";
          const publishedAt = typeof entry.published === "string" ? new Date(entry.published) : null;
          const rights = typeof entry.rights === "string" ? entry.rights.trim() : "";
          const authors = (Array.isArray(entry.author) ? entry.author : [entry.author])
            .flatMap((author: Record<string, unknown> | undefined) =>
              typeof author?.name === "string" && author.name.trim()
                ? [author.name.trim().slice(0, 120)]
                : [],
            )
            .slice(0, 8);
          const links = Array.isArray(entry.link) ? entry.link : [entry.link];
          const link = links.find(
            (candidate: Record<string, unknown> | undefined) =>
              candidate?.["@_rel"] === "alternate" &&
              typeof candidate?.["@_href"] === "string",
          );
          let sourceUrl: URL;
          try {
            sourceUrl = new URL(String(link?.["@_href"] ?? ""));
          } catch {
            continue;
          }
          if (
            !title ||
            !publishedAt ||
            !Number.isFinite(publishedAt.getTime()) ||
            publishedAt < input.start ||
            publishedAt > input.end ||
            sourceUrl.protocol !== "https:" ||
            sourceUrl.hostname !== ALLOWED_HOST ||
            sourceUrl.pathname === "/" ||
            !authors.length ||
            !hasAttributionNoDerivativesRights(rights)
          ) continue;

          documents.push(makeDocument({
            marketCode: "INTL",
            sourceType: "licensed-analysis",
            sourceName: `The Conversation · ${edition.label} edition`,
            sourceUrl: sourceUrl.toString(),
            title,
            publishedAt: publishedAt.toISOString(),
            languageCode: edition.language,
            tier: 2,
            entityConfidence: 0,
            raw: {
              publisher: "The Conversation",
              edition: edition.code,
              authors,
              feedUrl: edition.feed,
              rightsStatement: rights,
              attributionRequired: true,
              derivativesAllowed: false,
              contentPolicy: "unmodified-title-author-link-date-only",
              summaryDiscarded: true,
              articleBodyDiscarded: true,
              geographicMarketInferred: false,
            },
          }));
        }
      } catch {
        failures.push(edition.code);
      }
    }

    if (!requestsUsed) throw new Error("All The Conversation edition feeds failed");
    return {
      documents,
      requestsUsed,
      metadata: {
        editions: THE_CONVERSATION_EDITIONS.length,
        successfulFeeds,
        failedFeeds: failures,
        failedEditions: failures,
        resultCount: documents.length,
        contentStored: "unmodified title, author attribution, link, date, and feed rights only",
      },
    };
  }
}

async function readBoundedText(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export function hasAttributionNoDerivativesRights(value: string) {
  const rights = value.normalize("NFKC").toLocaleLowerCase();
  return rights.includes("creative commons") &&
    rights.includes("attribution") &&
    rights.includes("no derivatives");
}
