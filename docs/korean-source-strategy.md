# Korean source strategy

The MVP compares two configured information environments: Korean-language sources and an American/English source set. A source is never treated as representative of an entire market.

## Source status

- No Korean forum/community source is currently approved or configured. Do not label the current HN sample as a Korea/U.S. comparison.
- NAVER Search API and DataLab are **not currently suitable or approved**. NAVER announced migration to NAVER API HUB: new applications moved after 2026-07-31; only applications completed before then are scheduled to retain legacy Developer Center access through 2027-06-30. NAVER says the Hub currently has a basic free policy plus metered paid expansion, so it is not an unconditional forever-free promise. Current NAVER API terms also restrict copying/storing/caching results except narrow temporary windows, third-party provision, and AI use. Atlas's durable database, comparative analysis, and public evidence pages conflict with those stated limitations. No connector should be built/enabled unless NAVER gives written permission for this exact workflow or the architecture is redesigned to comply. See [`SOURCES.md`](SOURCES.md).
- Official RSS/Atom feeds are technically no-key options, not blanket reuse licenses. For example, SBS limits its RSS permission to personal non-commercial use; Kyunghyang says redistribution/sharing requires prior permission. Do not configure publisher feeds until the specific source permits Atlas's collection, storage, analysis, and display.
- Korean government RSS feeds (e.g. MOFA press releases) may be evaluated for official-policy context after checking each agency's reuse terms. They are institutional communications, not forum discourse or evidence of investor opinion; keep this source class separate.
- GDELT: keyless broad discovery with rate limits. It is not a substitute for a Korean forum API and is not proof of a story.
- Reddit: excluded. Reddit's current developer guidance says research use must go through the separate Reddit for Researchers program; ordinary Data API credentials are not an authorized research route. It is not a Korean forum source. Reconsider only if Atlas qualifies for and receives compatible program authorization; do not scrape Reddit pages.
- Kakao/Daum Cafe Search: Kakao officially exposes a Cafe post search endpoint; its published free quota is 30,000 requests/day at the time of review. The Kakao Developer Terms and Operating Policy prohibit publishing, translating, or otherwise providing data obtained through the service without prior approval. Therefore this is **not currently an authorized Atlas source**, even if a REST key is available and calls remain within the free quota. Obtain written permission for this product's ingestion, storage, analysis, and public display before enabling it. Never enable paid quotas or billing.

## Sources not implemented by scraping

DC Inside, Naver Cafes, Kakao communities, and other forum sites should not be scraped or bypassed. Kakao's official search endpoint does not remove the separate permission gate above. If an official authorized API or export becomes usable under explicit terms, add it as a typed connector with attribution, strict quotas, and retention rules.

## MVP interpretation

The product should show source counts, independent domains, language, source type, exact time window, and sample definition. It should describe a difference in configured source samples, not “what Koreans think” or “what Americans think.”
