import { describe, expect, it } from "vitest";
import { marketDiscussionQueries, marketTopicHashtags } from "./market-query-plan";
import { hasMarketSignalTerms } from "./market-summary";

describe("bounded transparent market-discussion query plan", () => {
  it.each([
    ["en", "GPU", "GPU prices"], ["ko", "반도체", "반도체 가격"],
    ["ja", "半導体", "半導体 価格"], ["de", "Halbleiter", "Halbleiter Preise"],
    ["fr", "cuivre", "cuivre prix"], ["pt", "cobre", "cobre preços"],
    ["es", "cobre", "cobre precios"], ["hi", "तांबा", "तांबा कीमत"],
  ])("retains the original plus one explicit price-context phrase for %s", (language, topic, supplement) => {
    expect(marketDiscussionQueries(topic, language)).toEqual([topic, supplement]);
  });
  it.each(["GPU prices", "inflation", "oil demand", "coffee supply", "unemployment"])("does not redundantly narrow an existing market intent: %s", (topic) => {
    expect(marketDiscussionQueries(topic, "en")).toEqual([topic]);
  });
  it("keeps reviewed adjacent solar wording as a separately visible bounded search", () => {
    expect(marketDiscussionQueries("solar panels", "en")).toEqual(["solar panels", "solar panels prices", "photovoltaics"]);
    expect(marketDiscussionQueries("Solarmodule", "de")).toEqual(["Solarmodule", "Solarmodule Preise", "Photovoltaik"]);
    expect(marketDiscussionQueries("solar panels in Germany", "en")).toEqual(["solar panels in Germany", "solar panels in Germany prices"]);
  });
  it("preserves a compound subject and one reviewed adjacent hashtag without generic split tags", () => {
    expect(marketTopicHashtags("solar panels", "en", ["SolarPanels", "SolarEnergy", "finance"])).toEqual(["SolarPanels", "Photovoltaics", "SolarEnergy"]);
    expect(marketTopicHashtags("Solarmodule", "de", ["Photovoltaik", "Erneuerbare"])).toEqual(["Solarmodule", "Photovoltaik", "Erneuerbare"]);
    expect(marketTopicHashtags("GPU", "en", ["bad/tag", "AI"])).toEqual(["GPU", "AI"]);
  });
  it("does not truncate a topic, infer an unsupported language or exceed the query cap", () => {
    expect(marketDiscussionQueries("x".repeat(100), "en")).toEqual(["x".repeat(100)]);
    expect(marketDiscussionQueries("GPU", "unknown")).toEqual(["GPU"]);
    expect(() => marketDiscussionQueries("x", "en")).toThrow();
    expect(() => marketDiscussionQueries("x".repeat(101), "en")).toThrow();
  });
  it.each(["prices", "margins", "inventories", "investors", "investments", "stocks", "shares", "profits", "losses", "tariffs", "exports", "imports", "commodities", "valuations", "dividends"])("accepts an explicit common market plural, not arbitrary stemming: %s", (word) => {
    expect(hasMarketSignalTerms({ excerpt: `GPU ${word} have changed.`, language: "en" })).toBe(true);
    expect(hasMarketSignalTerms({ excerpt: `GPU x${word}x is a name.`, language: "en" })).toBe(false);
  });
});
