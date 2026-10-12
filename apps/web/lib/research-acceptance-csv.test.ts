import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAcceptanceCsv } from "./research-acceptance-csv";

const template = (kind: "sources" | "results" | "claims") => readFileSync(resolve(process.cwd(), "../../docs", {
  sources: "researcher-acceptance-source-runs.csv", results: "researcher-acceptance-results.csv", claims: "researcher-acceptance-claims.csv",
}[kind]), "utf8").trim();

describe("acceptance worksheet imports", () => {
  it.each(["sources", "results", "claims"] as const)("accepts the header-only %s template without manufacturing evidence", (kind) => {
    expect(parseAcceptanceCsv(template(kind), kind)).toEqual([]);
    expect(parseAcceptanceCsv(`\ufeff${template(kind)}\r\n`, kind)).toEqual([]);
  });

  it("preserves unknown count cells and discards extra columns", () => {
    const headers = template("sources").split(",");
    const values = headers.map((key) => ({ run_id: "run-1", provider_status: "unavailable", topic_group: "PRIVATE-NOTE" })[key] ?? "");
    const [row] = parseAcceptanceCsv(`${headers.join(",")}\n${values.join(",")}`, "sources");
    expect(row.raw_returned_count).toBe("");
    expect(row.provider_status).toBe("unavailable");
    expect(JSON.stringify(row)).not.toContain("PRIVATE-NOTE");
  });

  it.each(["", "run_id", "run_id,run_id", "run_id,PRIVATE-HEADER", "\u0000"])("rejects invalid headers even with no data rows: %s", (content) => {
    expect(() => parseAcceptanceCsv(content, "sources")).toThrow("File contents withheld");
  });

  it("rejects duplicate and blank extra headers", () => {
    for (const suffix of [",run_id", ",", ",notes,notes"]) {
      expect(() => parseAcceptanceCsv(template("sources") + suffix, "sources")).toThrow("unique required headers");
    }
  });

  it("rejects malformed rows without exposing their content", () => {
    for (const data of ['"PRIVATE-RECORD', "PRIVATE-RECORD,too,few", "PRIVATE-RECORD\u0000"]) {
      let message = "";
      try { parseAcceptanceCsv(`${template("sources")}\n${data}`, "sources"); }
      catch (cause) { message = (cause as Error).message; }
      expect(message).toContain("File contents withheld");
      expect(message).not.toContain("PRIVATE-RECORD");
    }
  });

  it("rejects arbitrary binary labels rather than counting them as negative reviews", () => {
    const headers = template("results").split(",");
    const values = headers.map((key) => key === "atlas_included" ? "maybe-private-value" : "");
    expect(() => parseAcceptanceCsv(`${headers.join(",")}\n${values.join(",")}`, "results")).toThrow("yes/no/blank");
  });

  it("handles quoted commas and embedded newlines without changing field boundaries", () => {
    const headers = template("sources").split(",");
    const values = headers.map((key) => key === "baseline_query" ? '"copper, demand\npricing"' : "");
    expect(parseAcceptanceCsv(`${headers.join(",")}\n${values.join(",")}`, "sources")[0].baseline_query).toBe("copper, demand\npricing");
  });
});
