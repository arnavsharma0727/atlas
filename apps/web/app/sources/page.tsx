import Link from "next/link";
import SiteHeader from "../../components/site-header";

export const metadata = { title: "Sources | Atlas" };

export default function Sources() {
  return <div className="min-h-screen"><SiteHeader action={<Link href="/">← Search Atlas</Link>} />
    <main className="shell max-w-3xl py-12 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">How Atlas finds sources</h1>
      <p className="mt-5 leading-7 text-slate-300">Atlas now uses one research provider: Groq&apos;s built-in browser search. It searches the public web for pages relevant to your topic, the United States, and your selected market. The previous direct Bluesky, forum, statistical-data, and feed connectors are not part of the active search. Scheduled ingestion is off.</p>
      <p className="mt-5 leading-7 text-slate-300">Groq may return official statistics, company disclosures, reporting, and other public pages. Atlas accepts only direct HTTPS links and makes the comparison cite those returned links. This is a source-finding workflow, not independent verification: Groq can miss pages, misread dates, or produce a link that is wrong. Read the originals before relying on a conclusion.</p>
      <p className="mt-5 leading-7 text-slate-300">The source list is collapsed under each result. If no usable links or citation-valid comparison are returned, Atlas says so rather than filling the gap with unsupported claims. Search is subject to Groq&apos;s free-tier limits.</p>
      <p className="mt-7 text-sm text-slate-400"><a className="underline" href="https://console.groq.com/docs/tool-use/built-in-tools/browser-search" target="_blank" rel="noreferrer">Groq browser-search documentation ↗</a> · <Link className="underline" href="/methodology">Methodology</Link></p>
    </main></div>;
}
