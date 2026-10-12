import ExploreWorkspace from "./explore/explore-workspace";
import SiteHeader from "../components/site-header";

export default function ResearchDesk() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const deploymentCommit = commit && /^[a-f0-9]{7,40}$/iu.test(commit) ? commit : null;
  return (
    <div className="research-shell min-h-screen">
      <SiteHeader />
      <main className="shell">
        <ExploreWorkspace deploymentCommit={deploymentCommit} />
      </main>
    </div>
  );
}
