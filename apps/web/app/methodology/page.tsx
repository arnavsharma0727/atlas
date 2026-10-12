import Link from "next/link";
import SiteHeader from "../../components/site-header";

const sections = [
  {
    title: "A second AI pass is a guard, not verification",
    body: "After citation and numeric consistency checks, Atlas asks the same provider/model to review each draft claim against the same redacted excerpts. The review checks quantity relationships, negation, timing, attribution, scope, comparisons, and materially omitted contrary views. Rejection, uncertainty, a malformed review, or an unavailable check withholds the draft. Generation, format retries, correction, and review share at most three provider calls and a 23-second action budget. Agreement between two passes is correlated model judgment, not independent validation or proof of truth. False acceptance and false rejection remain possible. The downloadable audit records a passed check's state and claim count, not the reviewer prompt or excerpt text. Independent human acceptance testing is still required.",
  },
  {
    title: "Search is a discovery step, not a poll",
    body: "Atlas sends a topic to a small set of public search providers and returns records that match their indexes. Each provider has its own coverage, ranking, language, and time window. Search counts describe returned records only; they do not measure how many people hold a view or how much attention a market is receiving.",
  },
  {
    title: "Keep evidence types separate",
    body: "The focused search uses public discussion from Bluesky, Lemmy, and Mastodon. It requests official ECB/BIS currency, World Bank macro, or EIA energy context only when the topic applies. Official observations are dated, separate from conversation, and excluded from AI discussion summaries. Linked reports, promotional posts, and identifiable household-purchase or utility-bill advice remain citable but do not support an independent market overview. Atlas no longer runs title-only academic searches, play-money forecasts, specialist Q&A, or software forums in the default comparison: those sources added volume without establishing a country perspective. SEC requests remain disabled by operator policy.",
  },
  {
    title: "Official statistics are context, not a market quote",
    body: "Currency and FX searches can show BIS monthly nominal and real effective-exchange-rate indices for the U.S. and selected country. These are trade-weighted broad-basket indices, not bilateral spot exchange rates. An index increase indicates appreciation against its basket; the index level does not establish over- or undervaluation. Country indices use their own 2020=100 bases, so their levels should not be compared. These statistics are linked separately, not counted as discussion evidence, and never sent to the AI overview. Other official context can be annual or delayed; each source's date, unit, and limits appear with its record.",
  },
  {
    title: "Language is not a location",
    body: "A provider language label or writing system describes the text, not the author's nationality, residence, or a source's geography. A Korean-language post is not proof that its author is in South Korea. The selected country is a search lens only; Atlas never treats the returned set as a national sample.",
  },
  {
    title: "Summaries paraphrase; evidence stays inspectable",
    body: "AI claim text is expected to be concise and paraphrased. Each cited excerpt is separately shown in a collapsed disclosure so a researcher can inspect the exact submitted words. Duplicate citation IDs within or across the two lenses are rejected. Atlas rejects a claim that repeats a long supporting quote or cited excerpt, or contains a URL, email address, or @handle; it retries once, then withholds the AI overview if validation still fails. A matched quote still does not prove the paraphrase is logically supported or true.",
  },
  {
    title: "SEC is disabled; public datasets keep their own observation dates",
    body: "SEC requests are disabled by operator policy for both visitor search and scheduled ingestion. No SEC identity or contact email is required. Currency searches use the freely accessible ECB daily reference-rate snapshot as separate official context, with observation date, original server fetch time, units and attribution. The ECB publishes on working days; missing currencies and snapshots older than seven calendar days are marked partial. Reference rates are not live executable prices or opinions. Annual World Bank and monthly BIS series remain labeled at their actual observation frequency; newer retrieval does not make an older observation current.",
  },
  {
    title: "Read the original before drawing a conclusion",
    body: "The source register first applies a conservative query-term screen to titles and available excerpts, while preserving raw provider-return and screened-out counts. It can miss synonyms and is not semantic relevance verification. When the operator has enabled the optional AI service and it is available, the overview uses at most eight short, source-balanced excerpts per side; the AI screen additionally requires explicit market/economic vocabulary before source balancing and the excerpt cap. For a named-language lens, matching provider language labels are used. Lemmy language IDs are resolved from that same instance's live language catalog; if unavailable or unresolved, the record stays visible with an unknown language label. Conservative script detection can include Korean, Japanese, or Hindi only when provider language metadata is unavailable; explicit mismatches are excluded, and other unknown languages remain visible but are not summarized. Script detection identifies writing system, not nationality, residence, or community membership. Social records with attribution are capped at one excerpt per displayed account per provider/network; account labels are used only for this cap and are not sent to AI. External-link posts, posts explicitly crediting a publisher, and posts matching high-confidence stock-promotion phrases in English, Korean, Japanese, German, French, Spanish, Portuguese, or Hindi stay visible but are excluded from AI synthesis. Those phrase patterns can miss slang or coded promotion and can flag legitimate discussion. Lemmy posts without a returned body may contribute their post title as the only transient excerpt; this is labeled in the source record and is not a full-text view. The server repeats the topic and market-language gates and rejects empty or unscreened requests. Each one-sentence claim must cite exact submitted records, and each comparison claim must cite both sides. Every generated citation must include a verbatim substring from that exact excerpt; Atlas requires the returned quote to appear as an exact case- and whitespace-preserving substring and shows it in a collapsed disclosure linked to the citation. This lets a researcher inspect the model's selected words, but a matching quote does not prove it logically supports the claim, nor does any citation establish truth. Atlas rejects numeric details not present in the cited excerpts and labels social-post figures as unverified; these are consistency checks, not semantic entailment or truth verification. Source URLs and author handles are not sent to AI providers. Inspect the original record and its provenance. Without AI or when it fails, Atlas shows a limited rule-based overview and labels AI unavailable.",
  },
  {
    title: "Compare like with like",
    body: "The English-language baseline and selected country-language lens are separate searches, not national samples. Bluesky receives official language parameters; Lemmy searches the displayed phrase on country-relevant configured servers; Mastodon searches displayed hashtags, not arbitrary post text. Atlas reports insufficient evidence when either side has no qualifying discussion, and limited comparison when a side has fewer than three excerpts or two platforms. Even a cross-community sample does not verify contributor location, represent investors, or establish prevalence. Automatic translation is used only when the operator's AI service is available; the effective phrase is shown and can be refined by the researcher.",
  },
  {
    title: "Clarify short and ticker-like phrases",
    body: "Short acronyms and tickers can collide with ordinary words or unrelated entities. Atlas warns on common ambiguous forms and offers a small set of optional company/concept expansions. Choosing an expansion runs a new, separately labeled search; Atlas does not silently add aliases. This list is not exhaustive, so specify the company or concept when results are ambiguous.",
  },
];

export default function Methodology() {
  return (
    <div className="min-h-screen">
      <SiteHeader action={<Link href="/">← Search Atlas</Link>} />
      <main className="shell max-w-5xl py-10 md:py-14">
        <header className="max-w-3xl">
          <div className="eyebrow">Methodology</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            What a search result can—and cannot—tell you
          </h1>
          <p className="mt-4 text-base leading-7 text-muted">
            Atlas is a discovery tool for finding public conversations and
            reporting about a market topic across selected communities. It is
            not a census, sentiment index, investment recommendation, or
            automated thesis generator. Country selections are language/community
            lenses, not verified national samples.
          </p>
        </header>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {sections.map(({ title, body }, index) => (
            <section className="panel p-6 md:p-7" key={title}>
              <div className="eyebrow">{String(index + 1).padStart(2, "0")}</div>
              <h2 className="mt-2 text-lg font-semibold">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{body}</p>
            </section>
          ))}
        </div>

        <p className="mt-5 max-w-4xl text-sm leading-6 text-muted">
          Numbers and dates in generated claims must appear in the displayed
          supporting quotes, not merely elsewhere in a cited excerpt. Common
          English currency, scale and percentage-unit qualifiers must match
          literally; Atlas does not convert units. Other languages, localized
          number formats and unrecognized units are not fully checked. When a
          social-post number is present but the model does not clearly attribute
          it, Atlas labels it as an unverified claim from the cited post. This
          checks textual consistency only; it does not establish which metric a
          number describes, its direction, definition, provenance, or truth.
        </p>

        <section className="mt-6 border-y border-line py-5">
          <h2 className="text-lg font-semibold">Coverage is incomplete by design</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
            Results depend on public access, provider indexing, query wording,
            source activity, language, API limits, and the date window shown in
            each source group. Missing results do not establish that a topic is
            absent from a community. Search providers may rank, omit, or remove
            records, and independent-looking results may repeat the same
            underlying claim.
          </p>
        </section>

        <p className="mt-6 text-sm text-muted">
          See the <Link className="underline underline-offset-4" href="/sources">source register</Link> for
          current connectors and their specific limits.
        </p>
      </main>
    </div>
  );
}
