import Link from "next/link";
import SiteHeader from "../../components/site-header";

export const metadata = { title: "Privacy | Atlas" };

export default function Privacy() {
  return <div className="min-h-screen"><SiteHeader action={<Link href="/">← Search Atlas</Link>} />
    <main className="shell max-w-3xl py-12 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-5 leading-7 text-slate-300">Atlas sends the topic and selected country to its own server. The server sends separate U.S. and selected-market searches to Groq for browser-assisted source discovery. A final request sends Groq only the returned source titles, links, dates, and short descriptions for comparison. Groq&apos;s browser-search provider may process your query under its own terms. Do not enter private information into the search bar.</p>
      <p className="mt-5 leading-7 text-slate-300">The active interface does not save search history or research briefs. Results remain in the current page until you leave or search again. Atlas uses a server-side shared rate limit to protect the free Groq key; the key is never sent to your browser or committed to GitHub. Hosting, Groq, and the rate-limit service may retain operational logs under their own policies.</p>
      <p className="mt-7 text-sm text-slate-400"><a className="underline" href="https://console.groq.com/docs/your-data" target="_blank" rel="noreferrer">Groq data handling ↗</a> · <Link className="underline" href="/sources">Sources</Link></p>
    </main></div>;
}
