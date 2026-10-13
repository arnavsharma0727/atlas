import AtlasSearch from "./atlas-search";
import SiteHeader from "../components/site-header";

export default function ResearchDesk() {
  return (
    <div className="research-shell min-h-screen">
      <SiteHeader />
      <main className="shell">
        <AtlasSearch />
      </main>
    </div>
  );
}
