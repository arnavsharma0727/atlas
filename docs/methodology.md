# Atlas search methodology and limits

Atlas discovers current public conversation around a researcher-entered market interest. It is not a survey, sentiment score, attention measure, causal model, thesis generator, or investment recommendation.

## Retrieval and comparison

Each search runs a bounded English-language baseline using Bluesky, `lemmy.world`, and a public Mastodon hashtag timeline when a valid tag can be formed. For a non-U.S. language/community lens, Atlas additionally searches Bluesky, up to four configured Lemmy instances, the selected Mastodon instance(s), and headline metadata from twelve Global Voices editions. Global Voices is reporting, not forum discussion, and is kept out of the conversation summary. Every source group is labeled with its exact query, time window, retrieval time, result count, and status. Search results stay in page memory and are not written to visitor search history.

The English baseline adds a `lang:en` filter to Bluesky. Lemmy uses the phrase as entered. Mastodon searches a mechanically generated hashtag, not arbitrary post text; untagged posts are missed. When AI is explicitly enabled and available, Atlas may translate the phrase for selected-language providers. Otherwise it uses the phrase as entered. The exact phrase sent to each provider is shown. The country selector offers the United States/English, South Korea/Korean, Japan/Japanese, Germany/German, France/French, Brazil/Portuguese, India/Hindi, and Spain/Spanish. These are query/community lenses, not geolocation. The English baseline is not a verified sample of U.S. residents.

Bluesky returns up to 25 indexed posts per query from seven days. Lemmy searches up to 20 recent posts per configured instance from seven days; federated posts may overlap. Mastodon searches up to 20 newest posts per instance through hashtag timelines. Global Voices returns matching headline metadata only, up to five per edition over 30 days. Provider outages, partial edition failures, and rate limits are shown per source; failures are not shown as zero matches. Hacker News has been retired from visitor search pending content reuse review. Specialist Q&A and scheduled ingestion health do not feed the current search result.

## AI and privacy

AI is off by default and session-scoped. If the visitor opts in and the operator has explicitly enabled it, Atlas sends the topic and at most 16 short, source-balanced excerpts to Groq. Source URLs and author handles are excluded. Summaries are validated against the evidence IDs submitted with that request; factual passages need citations that link to original returned records. Model validation cannot guarantee factual accuracy, so inspect the sources. If AI is unavailable or a citation fails validation, Atlas shows a labeled evidence overview and does not invent a synthesis.

The code does not verify provider billing status. The operator must confirm free-tier eligibility independently and keep the feature disabled if free access is not confirmed. No paid plan or billing details are required by Atlas. Groq's [data handling](https://console.groq.com/docs/your-data) notes that prompts may be retained for reliability/abuse monitoring for up to 30 days; its [billing FAQ](https://console.groq.com/docs/billing-faqs) describes paid plan requirements.

## Interpretation

Returned counts are records, not unique people, public sentiment, prevalence, attention, investor positioning, or national opinion. Platform members, ranking systems, community languages, source caps, translations, and API indexing differ. Empty results do not establish absence. Verify material claims against primary information such as filings, official data, and company disclosures. Do not infer a financial conclusion from conversation volume alone.

The on-demand search is separate from protected scheduled ingestion, which may retain operational metadata in Supabase. See the [privacy notice](https://signal-scout-xi-ruby.vercel.app/privacy) and [source register](https://signal-scout-xi-ruby.vercel.app/sources).
