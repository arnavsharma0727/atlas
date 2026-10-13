import { describe, expect, it } from "vitest";
import { parseAtlasComparison, parseAtlasSources, parseGroqJson } from "./atlas-groq";

describe("Groq-only research validation", () => {
  const sources = parseAtlasSources({ sources: [
    { title: "U.S. industry report", url: "https://example.org/us", scope: "US", excerpt: "Demand is slowing while inventories rise across the sector.", publishedAt: "2026-10-10" },
    { title: "German industry report", url: "https://example.de/de", scope: "selected", excerpt: "German factory orders have weakened relative to last year.", publishedAt: "2026-10-09" },
  ] });
  it("parses fenced browser-search output and excludes Bluesky, unsafe and duplicate URLs", () => {
    expect(parseGroqJson('Search results:\n```json\n{"sources":[]}\n```')).toEqual({ sources: [] });
    expect(parseGroqJson('Browser hit {not json}\nFinal: {"sources":[]} 〖1†L2〗')).toEqual({ sources: [] });
    expect(parseAtlasSources({ sources: [
      { title: "Public Bluesky post", url: "https://bsky.app/post/1", scope: "US", excerpt: "A long enough irrelevant sentence for testing." },
      { title: "Internal address", url: "https://127.0.0.1/private", scope: "US", excerpt: "A long enough irrelevant sentence for testing." },
      { title: "U.S. industry report", url: "https://example.org/us", scope: "US", excerpt: "Demand is slowing while inventories rise across the sector." },
      { title: "Repeat report", url: "https://example.org/us", scope: "US", excerpt: "Demand is slowing while inventories rise across the sector." },
    ] })).toHaveLength(1);
  });
  it("drops cross-country claims that cite only one side while retaining valid side-specific claims", () => {
    expect(parseAtlasComparison({ us: [{ text: "U.S. demand appears weaker.", sourceIds: ["S1"] }],
      selected: [{ text: "German orders appear weaker.", sourceIds: ["S2"] }],
      differences: [{ text: "The two markets differ.", sourceIds: ["S1"] }], gaps: [] }, sources, "DE")?.differences).toEqual([]);
  });
  it("accepts a bounded comparison with source IDs from both sides", () => {
    expect(parseAtlasComparison({ us: [{ text: "U.S. demand appears weaker.", sourceIds: ["S1"] }],
      selected: [{ text: "German orders appear weaker.", sourceIds: ["S2"] }],
      differences: [{ text: "Both cited reports describe weakening activity.", sourceIds: ["S1", "S2"] }],
      gaps: ["Company margins are not established."] }, sources, "DE")?.differences).toHaveLength(1);
  });
  it("rejects numbers absent from the cited source descriptions", () => {
    expect(parseAtlasComparison({ us: [{ text: "U.S. chip demand increased 87% last year.", sourceIds: ["S1"] }],
      selected: [{ text: "German orders appear weaker.", sourceIds: ["S2"] }], differences: [], gaps: [] }, sources, "DE")).toBeNull();
  });
});
