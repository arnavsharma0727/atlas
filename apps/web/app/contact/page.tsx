import Link from "next/link";
import SiteHeader from "../../components/site-header";

export const metadata = { title: "Contact | Atlas" };

export default function Contact() {
  return (
    <div className="min-h-screen">
      <SiteHeader action={<Link href="/">← Research desk</Link>} />
      <main className="shell py-16">
        <section className="max-w-2xl">
        <div className="eyebrow mb-4">Contact</div>
        <h1 className="text-4xl font-extrabold">Report an issue</h1>
        <p className="mt-5 leading-7 text-muted">
          For a technical bug or concern about a source link returned by Atlas,
          the repository issue tracker is public. Include only the public
          source URL and a short reason; do not include names, private
          correspondence, personal information, passwords, API keys, or other
          secrets.
        </p>
        <p className="mt-4 leading-7 text-muted">
          This prototype does not yet have a private request channel. Do not
          post a privacy or personal-data request in the public issue tracker;
          the product is not ready for requests that require confidential
          contact.
        </p>
        <a
          className="btn mt-7"
          href="https://github.com/arnavsharma0727/atlas/issues"
          target="_blank"
          rel="noreferrer"
        >
          Open a GitHub issue
        </a>
        </section>
      </main>
    </div>
  );
}
