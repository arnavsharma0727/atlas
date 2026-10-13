import { describe, expect, it, vi } from "vitest";
import type { NormalizedDocument } from "./connectors/types";
import {
  excludeTakedownBlockedDocuments,
  isAuthorizedTakedownRequest,
  parseTakedownRequest,
  sourceUrlFingerprint,
} from "./source-takedown";

const document: NormalizedDocument = {
  sourceType: "rss",
  sourceName: "Publisher",
  sourceUrl: "https://publisher.example/story?utm_source=feed",
  canonicalUrl: "https://publisher.example/story",
  sourceDomain: "publisher.example",
  titleOriginal: "A research headline",
  publishedAt: "2026-09-30T12:00:00.000Z",
  sourceQualityTier: 2,
  entityMatchConfidence: 1,
  contentHash: "fixture-content-hash",
  rawMetadata: {},
};

describe("source takedown safeguards", () => {
  it("compares operator secrets without throwing on mismatched lengths", () => {
    expect(
      isAuthorizedTakedownRequest("operator-secret", "operator-secret"),
    ).toBe(true);
    expect(isAuthorizedTakedownRequest("short", "operator-secret")).toBe(false);
    expect(isAuthorizedTakedownRequest("éé", "aa")).toBe(false);
    expect(isAuthorizedTakedownRequest(null, "operator-secret")).toBe(false);
  });

  it("accepts only a UUID and a fixed reason code", () => {
    expect(
      parseTakedownRequest({
        documentId: "123e4567-e89b-42d3-a456-426614174000",
        reason: "privacy_request",
      }),
    ).toEqual({
      documentId: "123e4567-e89b-42d3-a456-426614174000",
      reason: "privacy_request",
    });
    expect(
      parseTakedownRequest({ documentId: "not-a-uuid", reason: "other" }),
    ).toBeNull();
    expect(
      parseTakedownRequest(["123e4567-e89b-42d3-a456-426614174000"]),
    ).toBeNull();
  });

  it("checks content and canonical URL blocks before ingest and fails closed", async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ fingerprint: sourceUrlFingerprint(document.canonicalUrl) }],
      error: null,
    });
    const range = vi.fn(() => query());
    const db = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ order: vi.fn(() => ({ range })) })) })),
    };
    const result = await excludeTakedownBlockedDocuments(db, [document]);
    expect(result).toEqual({ documents: [], excluded: 1 });
    expect(range).toHaveBeenCalledWith(0, 999);

    query.mockResolvedValue({
      data: null,
      error: new Error("database unavailable"),
    });
    await expect(
      excludeTakedownBlockedDocuments(db, [document]),
    ).rejects.toThrow("Takedown blocklist check failed");
  });

  it("paginates a large takedown blocklist and finds content fingerprints", async () => {
    const fingerprints = Array.from({ length: 1001 }, (_, index) => `dummy-${String(index).padStart(4, "0")}`);
    fingerprints[999] = document.contentHash;
    const range = vi.fn((from: number, to: number) => Promise.resolve({
      data: fingerprints.slice(from, to + 1).map((fingerprint) => ({ fingerprint })),
      error: null,
    }));
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({ range })),
        })),
      })),
    };

    const result = await excludeTakedownBlockedDocuments(db, [document]);
    expect(result).toEqual({ documents: [], excluded: 1 });
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });
});
