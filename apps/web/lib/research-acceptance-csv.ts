import { parse } from "csv-parse/sync";
import type { AcceptanceClaimRow, AcceptanceResultRow, AcceptanceSourceRow } from "./research-acceptance";

type Worksheets = { sources: AcceptanceSourceRow; results: AcceptanceResultRow; claims: AcceptanceClaimRow };
type ColumnKind = "text" | "binary";
type WorksheetSchema<T> = { [K in keyof T]: ColumnKind };

// Exhaustive typed schemas: adding a field to the evaluator requires updating
// its import contract too. Extra template columns remain compatible.
const schemas = {
  sources: {
    run_id: "text", run_date_utc: "text", deployed_commit: "text", topic_label: "text",
    baseline_query: "text", local_query: "text", selected_lens: "text", provider_key: "text",
    source_operator_key: "text", is_community_discussion: "binary", provider_status: "text",
    ui_status_accurate: "binary", raw_returned_count: "text", accepted_count: "text", excluded_count: "text",
  },
  results: {
    run_id: "text", selected_lens: "text", topic_label: "text", provider_key: "text",
    source_operator_key: "text", result_id: "text", atlas_included: "binary", atlas_summary_included: "binary",
    atlas_duplicate_flagged: "binary", reviewer_1_fluent: "binary", reviewer_2_fluent: "binary",
    reviewer_1_topic_match: "binary", reviewer_2_topic_match: "binary", adjudicated_topic_match: "binary",
    reviewer_1_market_relevance: "binary", reviewer_2_market_relevance: "binary", adjudicated_market_relevance: "binary",
    reviewer_1_geography_overclaim: "binary", reviewer_2_geography_overclaim: "binary", adjudicated_geography_overclaim: "binary",
    adjudicated_original_opinion: "binary", adjudicated_promotion_or_spam: "binary", adjudicated_language_correct: "binary",
    source_link_accessible: "binary", adjudicated_duplicate: "binary", adjudicated_duplicate_group: "text",
  },
  claims: {
    run_id: "text", selected_lens: "text", claim_id: "text", claim_type: "text",
    reviewer_1_fluent: "binary", reviewer_2_fluent: "binary", reviewer_1_citation_resolves: "binary",
    reviewer_2_citation_resolves: "binary", reviewer_1_exact_quote_present: "binary", reviewer_2_exact_quote_present: "binary",
    reviewer_1_semantic_support: "binary", reviewer_2_semantic_support: "binary", adjudicated_semantic_support: "binary",
    reviewer_1_describes_post_as_post: "binary", reviewer_2_describes_post_as_post: "binary", adjudicated_describes_post_as_post: "binary",
    reviewer_1_unsupported_geography: "binary", reviewer_2_unsupported_geography: "binary", adjudicated_unsupported_geography: "binary",
    adjudicated_comparison_cites_both_sides: "binary", adjudicated_counterevidence_omitted: "binary",
  },
} satisfies { [K in keyof Worksheets]: WorksheetSchema<Worksheets[K]> };

export function parseAcceptanceCsv<K extends keyof Worksheets>(content: string, kind: K): Worksheets[K][] {
  const invalid = () => new Error(`Invalid ${kind} worksheet: check CSV structure, unique required headers, and yes/no/blank labels. File contents withheld.`);
  if (content.includes("\u0000")) throw invalid();
  let table: string[][];
  try {
    table = parse(content, { columns: false, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    // Parser errors may include raw records or user-provided header values.
    throw invalid();
  }
  const headers = table[0]?.map((header) => header.trim());
  const schema = schemas[kind];
  if (!headers?.length || headers.some((header) => !header) || new Set(headers).size !== headers.length ||
    Object.keys(schema).some((key) => !headers.includes(key))) throw invalid();
  return table.slice(1).map((values) => {
    if (values.length !== headers.length) throw invalid();
    const record: Record<string, string> = {};
    for (const [key, columnKind] of Object.entries(schema)) {
      const value = values[headers.indexOf(key)].trim();
      if (columnKind === "binary" && !["", "yes", "no"].includes(value)) throw invalid();
      record[key] = value;
    }
    // Only declared fields survive; notes and extra personal data are discarded.
    return record as Worksheets[K];
  });
}
