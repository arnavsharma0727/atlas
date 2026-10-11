import { describe, expect, it } from "vitest";
import { buildCitationIds, buildPerspectiveSnapshot, citationKey, emptyInternationalOverviewMessage } from "./perspective-snapshot";
import type { ResearchSweepSourceResult } from "./research-sweep";

const result = (key: string, label: string, evidence: ResearchSweepSourceResult["evidence"]): ResearchSweepSourceResult => ({
  key, label, query: "topic", asOf: "2026-10-01T00:00:00.000Z", window: "recent", evidence, error: null, status: "complete",
});

const item = (id: string, source: string, language: string) => ({
  id, title: `Evidence ${id}`, url: `https://example.com/${id}`, source,
  evidenceClass: "social discussion" as const, language, timeLabel: "Published",
  timeValue: "2026-10-01T00:00:00.000Z", transientPreview: `Excerpt ${id}`,
});

describe("buildPerspectiveSnapshot", () => {
  it("does not describe an unavailable reporting source as an empty international sample", () => {
    const message = emptyInternationalOverviewMessage([
      { ...result("global-voices", "Global Voices", []), status: "unavailable", error: "temporarily unavailable" },
    ]);
    expect(message).toContain("could not be checked");
    expect(message).toContain("not evidence that a view is absent");
  });

  it("qualifies empty results when localized reporting coverage is partial", () => {
    const message = emptyInternationalOverviewMessage([
      { ...result("global-voices", "Global Voices", []), status: "partial", coverageNote: "2 editions unavailable" },
    ]);
    expect(message).toContain("coverage was partial");
    expect(message).toContain("See source status below");
  });

  it("keeps source classes and languages separate without inferring country views", () => {
    const snapshot = buildPerspectiveSnapshot([
      result("hacker-news", "Hacker News", [item("hn", "Hacker News", "English")]),
      result("stack-exchange:economics", "Economics", [item("en-se", "Economics Stack Exchange", "English")]),
      result("stack-exchange:es.stackoverflow", "Spanish Stack Overflow", [item("es-se", "Stack Overflow en español", "Spanish")]),
      result("global-voices", "Global Voices", [item("gv-es", "Global Voices · Spanish edition", "Spanish"), item("gv-ar", "Global Voices · Arabic edition", "Arabic")]),
      result("the-conversation:au", "The Conversation · Australia", [{ ...item("tc-au", "The Conversation · Australia edition", "English"), evidenceClass: "expert analysis" }]),
    ]);

    expect(snapshot.englishPerspectives.map(({ source, evidenceClass }) => [source, evidenceClass])).toEqual([
      ["Hacker News", "social discussion"],
      ["Economics Stack Exchange", "expert Q&A"],
    ]);
    expect(snapshot.englishPerspectives[0].items[0]).toMatchObject({ id: "hn", resultKey: "hacker-news" });
    expect(snapshot.otherPerspectives.map(({ source, language }) => [source, language])).toEqual([
      ["Stack Overflow en español", "Spanish"],
      ["Global Voices · Spanish edition", "Spanish"],
      ["Global Voices · Arabic edition", "Arabic"],
      ["The Conversation · Australia edition", "English"],
    ]);
    expect(snapshot.otherPerspectives.flatMap(({ items }) => items).map(({ title }) => title)).not.toContain("Evidence hn");
    expect(snapshot.otherPerspectives[0].evidenceClass).toBe("expert Q&A");
  });

  it("does not infer country from English language or duplicate repeated links", () => {
    const snapshot = buildPerspectiveSnapshot([
      result("hacker-news", "Hacker News", [
        item("same", "Hacker News", "English"),
        { ...item("same-copy", "Hacker News", "English"), url: "https://example.com/same" },
      ]),
      result("lemmy:lemmy.world", "Lemmy", [item("lemmy", "Lemmy · lemmy.world / c/economy", "English")]),
    ]);
    expect(snapshot.englishPerspectives).toHaveLength(1);
    expect(snapshot.otherPerspectives).toEqual([
      expect.objectContaining({ source: "Lemmy · lemmy.world / c/economy", language: "English" }),
    ]);
  });

  it("assigns citation IDs that resolve to the exact result entry without provider ID collisions", () => {
    const results = [
      result("hacker-news", "Hacker News", [item("42", "Hacker News", "English")]),
      result("lemmy:lemmy.world", "Lemmy", [item("42", "Lemmy", "English")]),
    ];
    const ids = buildCitationIds(results);
    expect(ids.get(citationKey("hacker-news", "42"))).toBe("C1");
    expect(ids.get(citationKey("lemmy:lemmy.world", "42"))).toBe("C2");
  });

});
