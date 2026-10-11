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
          <p className="mt-3 text-sm text-muted">Last updated: October 9, 2026</p>
          <section className="mt-8 space-y-6 leading-7 text-muted">
            <p>
              Atlas is a public-conversation search tool. Search terms and
              results are held in the page while you use it; the current search
              interface does not create an account, save a personal search
              history, or save research briefs.
            </p>
            <p>
              Search requests are sent to the relevant public search provider.
              The Global Voices request is routed through an Atlas server
              endpoint; that endpoint applies a short-window, IP-keyed,
              best-effort rate limit. Bluesky, Lemmy, and Mastodon
              searches are sent from your browser to their public APIs. Forum
              excerpts are held transiently in the page; content-warning
              Mastodon posts are shown without a text preview. Those providers
              and Atlas&apos;s hosting infrastructure may process technical
              request data under their own terms and operational logging
              practices. Atlas does not control their retention.
            </p>
            <p>
              Only when a visitor checks the optional AI box, Atlas sends the
              topic and up to 16 short public-source excerpts (without source
              URLs or author handles) to Groq for translation and summary.
              This feature requires a server-side Groq API key and a server
              configuration explicitly marked free-tier; Atlas does not
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
              Atlas does not intentionally persist your on-demand search terms
              or returned search results as a user search history. Search
              results are displayed temporarily and link back to their
              providers. Avoid entering personal, confidential, or sensitive
              information as a search query.
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
