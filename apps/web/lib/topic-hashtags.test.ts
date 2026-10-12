import { describe, expect, it } from "vitest";
import { isValidTopicHashtag, topicHashtags } from "./topic-hashtags";

describe("topicHashtags", () => {
  it("preserves Hindi vowel signs and rejects mark-only, markup, or oversized tags", () => {
    expect(topicHashtags("महंगाई")).toEqual(["महंगाई"]);
    expect(isValidTopicHashtag("महंगाई")).toBe(true);
    expect(isValidTopicHashtag("e\u0301nergie")).toBe(true);
    for (const value of ["\u0301", "---", "a/b", "<script>", "a".repeat(51)]) expect(isValidTopicHashtag(value)).toBe(false);
  });
  it.each([
    ["natural gas demand", ["NaturalGas"]],
    ["Shell natural gas supply", ["Shell", "NaturalGas"]],
    ["electric vehicle demand", ["ElectricVehicles"]],
    ["Tesla electric vehicles earnings", ["Tesla", "ElectricVehicles"]],
    ["artificial intelligence stocks", ["ArtificialIntelligence"]],
    ["rare earth supply", ["RareEarths"]],
    ["real estate prices", ["RealEstate"]],
    ["interest rates", ["InterestRates"]],
    ["gas natural", ["GasNatural"]],
    ["gás natural", ["GásNatural"]],
    ["gaz naturel", ["GazNaturel"]],
    ["천연 가스", ["천연가스"]],
    ["प्राकृतिक गैस", ["प्राकृतिकगैस"]],
  ])("preserves a compound market subject in %s", (topic, tags) => {
    expect(topicHashtags(topic)).toEqual(tags);
  });

  it("matches case and spacing without swallowing unrelated words or changing the cap", () => {
    expect(topicHashtags("NATURAL   GAS natural gas")).toEqual(["NaturalGas"]);
    expect(topicHashtags("unnatural gaslight")).toEqual(["Unnatural", "Gaslight"]);
    expect(topicHashtags("Shell natural gas electric vehicles real estate")).toEqual(["Shell", "NaturalGas", "ElectricVehicles"]);
  });

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
