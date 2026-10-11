# Atlas source register

This describes the visitor-facing workflow in the current code. `/sources` is the live operational register; [data-sources.md](data-sources.md) documents search limits and privacy.

## Search providers

| Source | Product role | Scope and limitation |
| --- | --- | --- |
| Bluesky AppView | Public social discussion | Public search, last seven days, up to 25 indexed posts per phrase. English baseline adds `lang:en`; the selected lens uses its query phrase. Language is not author geolocation; excerpts are transient. |
| Lemmy instances | Public federated forum posts | Public API query to `lemmy.world`, `discuss.tchncs.de`, `feddit.org`, and `jlai.lu`; up to 20 recent matching posts per instance in seven days. Federation may duplicate posts; no blanket reuse license is implied. Instance terms and privacy links are listed on `/sources`. |
| Mastodon instances | Public hashtag conversation | Public hashtag timeline, up to 20 newest posts per queried instance. Atlas mechanically formats the phrase as a hashtag; untagged discussion and nonmatching tags are missed. Instances can restrict public access. |
| Global Voices editions | International reporting context | Non-U.S. lens only: twelve language editions, headline metadata only, 30-day window and capped results. One publisher's editions are not independent forums or country samples. |

The form compares an English-language baseline with one selected country/language lens from eight options: U.S./English, South Korea/Korean, Japan/Japanese, Germany/German, France/French, Brazil/Portuguese, India/Hindi, and Spain/Spanish. These are query and community lenses, not verified contributor geographies. The product presents the English and selected-language summaries separately and lists sources beneath; it does not combine the international sample into one national-opinion estimate.

Hacker News is retired from visitor search while content display/reuse review is unresolved. Stack Exchange, Wikimedia talk pages, and scheduled feeds shown in operational health are not automatically included in this search.

AI translation and summaries are attempted automatically when a visitor submits a search; the search page discloses that the topic and up to 16 short excerpts are sent to Groq, without source URLs or author handles. Server configuration (`GROQ_FREE_TIER_ENABLED=true` and a private key) is still required. The code does not verify an account's Groq billing status; operators must independently confirm free-tier eligibility and must not enable paid billing for Atlas. Groq's free availability and rate limits are not guaranteed by Atlas. Groq's [data handling](https://console.groq.com/docs/your-data) and [billing FAQ](https://console.groq.com/docs/billing-faqs) apply; see Atlas's [privacy notice](https://signal-scout-xi-ruby.vercel.app/privacy).

## Operational ingestion is separate

Scheduled or optional ingestion may include Stack Exchange, Global Voices, The Conversation, European Commission Presscorner, Typst Forum, Fedora Discussion, Wikimedia talk-page metadata, or explicitly configured RSS/MOIS feeds. These operational records are not automatically part of the public search response or the country comparison. Ingested metadata has separate retention and rights controls.

## Not active in visitor search

- GDELT live search is retired after provider rate-limit/timeout failures.
- Stack Exchange remains an operational specialist Q&A source but is not included in this focused conversation search.
- Wikinews is archived, not a current source.
- YouTube comments are not implemented; API keys, quotas, and additional policy requirements apply.
- Reddit, X, Naver, and Kakao forum search are not integrated. Do not scrape around access controls, terms, or rate limits.
