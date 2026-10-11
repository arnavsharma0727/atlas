import Link from "next/link";
import type { ReactNode } from "react";

/** A quiet, single-purpose brand bar for the search application. */
export default function SiteHeader({ action }: { action?: ReactNode } = {}) {
  return (
    <header className="site-masthead">
      <div className="shell site-masthead-inner">
        <div className="site-brand-block">
          <Link href="/" className="site-brand" aria-label="Atlas home">
            ATLAS
          </Link>
        </div>
        {action && <span className="site-tagline">{action}</span>}
      </div>
    </header>
  );
}
