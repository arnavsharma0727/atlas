import Link from "next/link";
import SiteHeader from "../../components/site-header";

const sections = [
  {
    title: "Search is a discovery step, not a poll",
    body: "Atlas sends a topic to a small set of public search providers and returns records that match their indexes. Each provider has its own coverage, ranking, language, and time window. Search counts describe returned records only; they do not measure how many people hold a view or how much attention a market is receiving.",
  },
  {
    title: "Keep evidence types separate",
    body: "The live search currently returns public social discussion from Bluesky and Lemmy, hashtag posts from Mastodon, title-only questions from the Economics, Quantitative Finance, and Personal Finance Stack Exchange communities, and Japanese, Portuguese, or Spanish Stack Overflow questions for the corresponding selected language lens. Non-U.S. searches also include headline metadata from Global Voices reporting. Q&A and reporting are separate evidence classes, not forum opinion. Scheduled operational feeds shown in the source register are not mixed into this visitor search.",
  },
  {
    title: "Read the original before drawing a conclusion",
    body: "The source register first applies a conservative query-term screen to titles and available excerpts, while preserving raw provider-return and screened-out counts. It can miss synonyms and is not semantic relevance verification. When the operator has enabled the optional AI service and it is available, the overview uses at most eight short, source-balanced excerpts per side; the AI screen additionally requires explicit market/economic vocabulary before source balancing and the excerpt cap. For a named-language lens, matching provider language labels are used; when metadata is missing or instance-specific, conservative script detection can include Korean, Japanese, or Hindi text. Explicitly mismatched labels are excluded, and other unknown languages remain visible but are not summarized. Script detection identifies writing system, not nationality, residence, or community membership. Social records with attribution are capped at one excerpt per displayed account per provider/network; account labels are used only for this cap and are not sent to AI. Lemmy posts without a returned body may contribute their post title as the only transient excerpt; this is labeled in the source record and is not a full-text view. The server repeats the topic and market-language gates and rejects empty or unscreened requests. Each one-sentence claim must cite exact submitted records, and each comparison claim must cite both sides. Atlas labels generated prose as unverified cited material and rejects numeric details not present in the cited excerpts; this is a consistency check, not semantic entailment or truth verification. Citations are collected with the source records below the overview. Source URLs and author handles are not sent to Groq. Inspect the original record and its provenance. Without AI or when it fails, Atlas shows a limited rule-based overview and labels AI unavailable.",
  },
  {
    title: "Compare like with like",
    body: "The baseline may include mixed languages: Bluesky receives a `lang:en` filter only when the query fits its provider limit, Lemmy uses the displayed phrase, and Mastodon searches a mechanically formatted hashtag. Stack Exchange searches title-only questions in three English-language specialist communities; the selected lens also searches its corresponding Japanese, Portuguese, or Spanish Stack Overflow site where one is available. Queries must be 3–80 characters; this is expert Q&A, not a general forum or investor sample. The selected lens uses an automatic translation only when the operator has enabled the server-side AI service; researchers can instead enter an explicit phrase, and the effective phrase is shown. Global Voices searches headlines in localized editions and represents reporting, not conversation. These provider samples are not like-for-like; each query and time window is shown separately. Language, publication edition, server, and community do not verify contributor location.",
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
