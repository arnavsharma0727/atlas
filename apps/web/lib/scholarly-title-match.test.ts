import { describe, expect, it } from "vitest";
import { matchesScholarlyTitle, scholarlySearchTokens } from "./scholarly-title-match";

describe("scholarly Unicode title matching", () => {
  it.each([
    ["Oil demand and prices", "oil", true], ["Soil demand and prices", "oil", false],
    ["Bitcoin marketing attention", "bitcoin market", false], ["Bitcoin market attention", "bitcoin market", true],
    ["Marché du cuivre", "marche\u0301 cuivre", true], ["Copper export", "copper exports", false],
    ["सोने की कीमत नीति", "कीमत नीति", true], ["मत नीति", "कीमत नीति", false],
    ["半導体の供給網", "半導体", true], ["반도체 공급망 연구", "반도체 공급망", true],
    ["반도체 시장 연구", "반도체 공급망", false], ["Copper and prices", "prices of copper", true],
    ["Oil demand", "", false],
  ])("screens %s against %s without substring leakage", (title, query, expected) => {
    expect(matchesScholarlyTitle(title, query)).toBe(expected);
  });
  it("preserves vowel signs in upstream terms and never emits mark-only tokens", () => {
    expect(scholarlySearchTokens("कीमत नीति")).toEqual(["कीमत", "नीति"]);
    expect(scholarlySearchTokens("\u0301 \u0940")).toEqual([]);
    expect(scholarlySearchTokens("ＭＡＲＫＥＴ")).toEqual(["MARKET"]);
  });
});
