import type { LemmyInstance } from "./lemmy-public";
import type { MastodonInstance } from "./mastodon-public";

/** Country choice selects a query language and relevant community lens, never poster nationality. */
export type MarketCountry = {
  code: string;
  name: string;
  language: string;
  languageName: string;
  lemmyInstances: readonly LemmyInstance[];
  mastodonInstances: readonly MastodonInstance[];
  /** Localized Stack Exchange Q&A is available only on these verified language sites. */
  stackExchangeSites?: readonly string[];
};

export const MARKET_COUNTRIES: readonly MarketCountry[] = [
  { code: "US", name: "United States", language: "en", languageName: "English", lemmyInstances: ["lemmy.world"], mastodonInstances: ["mastodon.social"] },
  { code: "KR", name: "South Korea", language: "ko", languageName: "Korean", lemmyInstances: ["lemmy.world"], mastodonInstances: ["mastodon.social", "mastodon.world"] },
  { code: "JP", name: "Japan", language: "ja", languageName: "Japanese", lemmyInstances: ["lemmy.world"], mastodonInstances: ["mstdn.jp"], stackExchangeSites: ["ja.stackoverflow"] },
  { code: "DE", name: "Germany", language: "de", languageName: "German", lemmyInstances: ["discuss.tchncs.de", "feddit.org"], mastodonInstances: ["mastodon.social", "mastodon.world"] },
  { code: "FR", name: "France", language: "fr", languageName: "French", lemmyInstances: ["jlai.lu"], mastodonInstances: ["mastodon.social", "mastodon.world"] },
  { code: "BR", name: "Brazil", language: "pt", languageName: "Portuguese", lemmyInstances: ["lemmy.world"], mastodonInstances: ["mastodon.social", "mastodon.world"], stackExchangeSites: ["pt.stackoverflow"] },
  { code: "IN", name: "India", language: "hi", languageName: "Hindi", lemmyInstances: ["lemmy.world"], mastodonInstances: ["mastodon.social", "mastodon.world"] },
  { code: "ES", name: "Spain", language: "es", languageName: "Spanish", lemmyInstances: ["lemmy.world"], mastodonInstances: ["mastodon.social", "mastodon.world"], stackExchangeSites: ["es.stackoverflow"] },
];

export function marketCountry(code: string): MarketCountry {
  const country = MARKET_COUNTRIES.find((item) => item.code === code);
  if (!country) throw new Error("Choose one of the supported country search lenses.");
  return country;
}
