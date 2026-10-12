import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import {
  evaluateResearchAcceptance,
  type AcceptanceClaimRow,
  type AcceptanceResultRow,
  type AcceptanceSourceRow,
} from "../apps/web/lib/research-acceptance";

const docs = resolve(process.cwd(), "docs");
const [sourcePath, resultPath, claimPath] = process.argv.slice(2).map((path) => resolve(path));
main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : "Unable to evaluate acceptance files"}\n`);
  process.exitCode = 1;
});

async function main() {
  const sources = await readCsv<AcceptanceSourceRow>(sourcePath || resolve(docs, "researcher-acceptance-source-runs.csv"));
  const results = await readCsv<AcceptanceResultRow>(resultPath || resolve(docs, "researcher-acceptance-results.csv"));
  const claims = await readCsv<AcceptanceClaimRow>(claimPath || resolve(docs, "researcher-acceptance-claims.csv"));
  const report = evaluateResearchAcceptance({ sources, results, claims });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.scoreEligible) process.exitCode = 2;
}

async function readCsv<T>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf8");
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Array<Record<string, string>>;
  if (!records.length) return [];
  return records.map((row, index) => {
    if (Object.values(row).some((value) => value.includes("\u0000"))) {
      throw new Error(`${path}:${index + 2}: contains a NUL byte`);
    }
    return row as T;
  });
}
