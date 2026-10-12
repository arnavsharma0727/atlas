import { describe, expect, it } from "vitest";
import { publicationDateFromISO, publicationDateFromParts, publicationTimestampUTC } from "./publication-date";

describe("provider calendar dates", () => {
  it.each([
    [[2026], "2026"], [[2026, 2], "2026-02"], [[2024, 2, 29], "2024-02-29"],
    [[2026, 4, 30], "2026-04-30"],
  ])("preserves actual precision %j", (parts, expected) => {
    const parsed = publicationDateFromParts(parts);
    expect(parsed?.value).toBe(expected);
    expect(Number.isFinite(parsed?.timestamp)).toBe(true);
  });
  it.each([
    [], [2026, 0], [2026, 13], [2026, -1], [2026, 4, 31], [2026, 2, 29],
    [2024, 2, 30], [2026, 1, 0], [2026, 1, 32], [2026, null], [2026, true],
    ["2026"], [2026, "2"], [2026.5], [2026, 1, 1, 2], [99], [10000],
  ])("rejects invalid or coerced parts %j", (...args) => {
    // Vitest expands array table rows into arguments.
    expect(publicationDateFromParts(args)).toBeNull();
  });
  it.each([null, "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "2026-01-01Z", "2026", "2026-02"])("rejects malformed ISO date %s", (value) => {
    expect(publicationDateFromISO(value)).toBeNull();
  });
  it("accepts strict ISO leap day without inventing a time", () => {
    expect(publicationDateFromISO("2024-02-29")?.value).toBe("2024-02-29");
  });
  it.each(["2026-02-29T12:00:00Z", "2026-04-31T12:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T12:60:00Z", "2026-01-01", "2026-01-01T12:00:00", "2026-01-01T12:00:00+03:00"])("rejects invalid/unsupported UTC timestamps %s", (value) => {
    expect(publicationTimestampUTC(value)).toBeNull();
  });
  it("accepts UTC times including milliseconds on a real leap day", () => {
    expect(publicationTimestampUTC("2024-02-29T23:59:59.125Z")).toBe(Date.parse("2024-02-29T23:59:59.125Z"));
  });
});
