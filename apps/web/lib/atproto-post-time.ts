import { publicationDateFromISO } from "./publication-date";

/** Modern post times only, not a general-purpose historical Lexicon datetime validator.
 * Require explicit zone/seconds and a real calendar date; never repair or use index time.
 * Fractional seconds are reduced to milliseconds only for window comparison/display.
 */
export function atprotoPostTime(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 128) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u);
  if (!match || !publicationDateFromISO(match[1]) || match[6] === "-00:00") return null;
  const fractional = match[5] ? `.${match[5].slice(0, 3).padEnd(3, "0")}` : "";
  const timestamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${fractional}${match[6]}`);
  return Number.isFinite(timestamp) ? timestamp : null;
}
