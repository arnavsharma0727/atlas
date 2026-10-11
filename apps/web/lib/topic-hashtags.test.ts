import { describe, expect, it } from "vitest";
import { topicHashtags } from "./topic-hashtags";

describe("topicHashtags", () => {
  it("keeps up to three distinct words as individually searchable tags", () => {
    expect(topicHashtags("Nvidia earnings Nvidia reaction supply chain"))
      .toEqual(["Nvidia", "Reaction"]);
  });

  it("preserves a one-word topic and Unicode words", () => {
    expect(topicHashtags("AI")).toEqual(["AI"]);
    expect(topicHashtags("半導体 市場 전망")).toEqual(["半導体", "市場", "전망"]);
  });

  it("drops empty and one-letter connective fragments and caps hashtag sizes", () => {
    expect(topicHashtags("S&P 500")).toEqual(["SP500"]);
    expect(topicHashtags("S&P 500 and AI")).toEqual(["SP500", "AI"]);
    expect(topicHashtags("Nvidia earnings and supply chain")).toEqual(["Nvidia"]);
    expect(topicHashtags("x".repeat(60))).toEqual([]);
    expect(topicHashtags("***")).toEqual([]);
  });
});
