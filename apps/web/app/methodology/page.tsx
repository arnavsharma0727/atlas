import Link from "next/link";
import SiteHeader from "../../components/site-header";

export const metadata = { title: "Methodology | Atlas" };

export default function Methodology() {
  return <div className="min-h-screen"><SiteHeader action={<Link href="/">← Search Atlas</Link>} />
    <main className="shell max-w-3xl py-12 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">How to read a comparison</h1>
      <p className="mt-5 leading-7 text-slate-300">Groq browser search looks for public pages about the United States and the selected country and drafts short points from its returned source descriptions. Atlas normally makes one request and may try its other free-tier model once after a rate limit. Atlas rejects unknown citation IDs and cross-market contrasts that do not cite both markets. It does not treat search rank, discussion volume, or a language as a national opinion poll.</p>
      <p className="mt-5 leading-7 text-slate-300">The overview considers demand, supply, pricing, company performance, policy, financing and risks when sources actually cover them. An absent dimension remains unknown. It does not establish a share-price effect, intrinsic value, or a buy/sell recommendation.</p>
      <p className="mt-5 leading-7 text-slate-300">These checks establish that each displayed point refers to a returned link; they do not prove that the page exists, that its date or excerpt is accurate, or that the point is logically entailed. Groq performs both source finding and comparison in one response; Atlas is not an independent reviewer. Open the original links and verify material claims before using Atlas for research.</p>
      <p className="mt-7 text-sm text-slate-400"><Link className="underline" href="/sources">Source coverage</Link> · <Link className="underline" href="/privacy">Privacy</Link></p>
    </main></div>;
}
