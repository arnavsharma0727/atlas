import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseAcceptanceCsv } from "../apps/web/lib/research-acceptance-csv";
import {
  evaluateResearchAcceptance,
} from "../apps/web/lib/research-acceptance";

const docs = resolve(process.cwd(), "docs");
const [sourcePath, resultPath, claimPath] = process.argv.slice(2).map((path) => resolve(path));
main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : "Unable to evaluate acceptance files"}\n`);
  process.exitCode = 1;
});

async function main() {
  const sources = parseAcceptanceCsv(await readFile(sourcePath || resolve(docs, "researcher-acceptance-source-runs.csv"), "utf8"), "sources");
  const results = parseAcceptanceCsv(await readFile(resultPath || resolve(docs, "researcher-acceptance-results.csv"), "utf8"), "results");
  const claims = parseAcceptanceCsv(await readFile(claimPath || resolve(docs, "researcher-acceptance-claims.csv"), "utf8"), "claims");
  const report = evaluateResearchAcceptance({ sources, results, claims });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.scoreEligible) process.exitCode = 2;
}
