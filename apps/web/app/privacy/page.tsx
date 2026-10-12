import Link from "next/link";
import SiteHeader from "../../components/site-header";

export const metadata = { title: "Privacy | Atlas" };

export default function Privacy() {
  return (
    <div className="min-h-screen">
      <SiteHeader action={<Link href="/">← Search Atlas</Link>} />
      <main className="shell py-16">
        <article className="max-w-3xl">
          <div className="eyebrow mb-4">Privacy</div>
          <h1 className="text-4xl font-extrabold">How Atlas search handles information</h1>
          <p className="mt-3 text-sm text-muted">Last updated: October 11, 2026</p>
          <section className="mt-8 space-y-6 leading-7 text-muted">
            <p>
              Atlas is a public-conversation search tool. Search terms and
              results are held in the page while you use it; the current search
              interface does not create an account, save a personal search
              history, or save research briefs.
            </p>
            <p>
              Search requests are sent to the relevant public search provider.
              arXiv, OpenAlex, Crossref, SEC EDGAR, Global Voices, and The Conversation requests are routed through
              Atlas server endpoints; those endpoints apply short-window,
              IP-keyed, best-effort rate limits. Bluesky, Lemmy, Mastodon, and Stack
              Exchange searches are sent from your browser to their public
              APIs. Manifold search terms are also sent directly from your
              browser to its public, read-only API; returned forecast metadata
              is held transiently in the page and is not sent to Groq. Public
              discussion excerpts and Q&amp;A titles are held transiently in
              the page; Q&amp;A titles are not sent to Groq.
              Content-warning Mastodon posts are shown without a text preview.
              Those providers
              and Atlas&apos;s hosting infrastructure may process technical
              request data under their own terms and operational logging
              practices. Atlas does not control their retention.
            </p>
            <p>
              For SEC EDGAR context, Atlas checks an exact company name or
              ticker against the public issuer index and, on a match, requests
              that issuer&apos;s filing metadata by CIK. The text you typed is
              not sent to the SEC. Atlas does not fetch filing bodies or send
              filing metadata to Groq. SEC requests require an operator-set
              User-Agent with a contact email; the issuer index may be cached
              by the hosting platform for up to one day and matching filing
              metadata in server memory for five minutes. SEC and hosting
              infrastructure may log network requests under their own
              policies.
            </p>
            <p>
              When a visitor submits a search, Atlas automatically attempts
              AI translation and a summary by sending the topic and up to 16
              short public-source excerpts (with links, emails, and @handles
              removed) to Groq. This feature requires a server-side Groq API
              key and a server configuration explicitly marked free-tier; Atlas does not
              upgrade an account or add billing details. The free-tier status
              must be confirmed by the project operator in Groq settings.
              Groq says prompts are not retained by default for inference, but
              reliability and abuse monitoring may retain prompts for up to
              30 days; usage metadata is collected. See its <a className="underline text-ink" href="https://console.groq.com/docs/your-data" target="_blank" rel="noreferrer">data handling documentation</a>.
              If AI is off or unavailable, Atlas labels a local evidence
              overview or AI-unavailable fallback. Queries also go to the public
              sources listed on the Sources page. Avoid entering personal,
              confidential, or sensitive information.
            </p>
            <p>
              Atlas does not write on-demand searches to durable user history.
              To respect provider request limits, identical OpenAlex and Crossref searches
              may be cached in server memory for 60 seconds and arXiv searches
              for 24 hours; these caches are not durable or shared across
              serverless instances. Results are also held temporarily in the
              page. Providers and hosting infrastructure may separately log
              requests under their policies. Avoid entering personal,
              confidential, or sensitive information as a search query.
            </p>
            <p>
              Atlas also has server-side operational data services for
              scheduled collection and source monitoring. These are separate
              from the on-demand search page. Historical records may remain in
              the service database under its operational retention practices;
              the search UI does not let visitors create or manage those
              records. Current source and collection limitations are described
              in the <Link className="underline text-ink" href="/sources">source register</Link>.
            </p>
            <p>
              Atlas is hosted by Vercel and may use Supabase for server-side
              operational storage. Those services process information needed
              to deliver and secure the application. Server credentials are
              kept on the server and are not intentionally sent to the
              browser.
            </p>
            <p>
              Atlas does not claim that public posts represent a country,
              population, or market. Language and publication edition do not
              establish a contributor&apos;s location. See the{" "}
              <Link className="underline text-ink" href="/methodology">methodology</Link> for
              interpretation limits.
            </p>
            <p>
              To report a privacy or source concern, use the{" "}
              <Link className="underline text-ink" href="/contact">contact page</Link>.
              Do not submit private or sensitive information through a public
              issue tracker.
            </p>
            <p>
              This notice describes the current prototype and may change as
              Atlas changes. It is an operational description, not legal
              advice.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
