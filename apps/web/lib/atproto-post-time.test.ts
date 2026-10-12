import { describe, expect, it } from "vitest";
import { atprotoPostTime } from "./atproto-post-time";

describe("modern AT Protocol post timestamp", () => {
  it.each([
    ["2026-10-02T12:00:00Z", "2026-10-02T12:00:00.000Z"],
    ["2026-10-02T12:00:00.12345678912345Z", "2026-10-02T12:00:00.123Z"],
    ["2026-10-02T12:00:00.1Z", "2026-10-02T12:00:00.100Z"],
    ["2026-10-02T05:00:00.120000-07:00", "2026-10-02T12:00:00.120Z"],
    ["2026-10-03T01:30:00+13:30", "2026-10-02T12:00:00.000Z"],
    ["2024-02-29T00:00:00+00:00", "2024-02-29T00:00:00.000Z"],
  ])("preserves the instant of %s at millisecond resolution", (value, expected) => {
    expect(atprotoPostTime(value)).toBe(Date.parse(expected));
  });
  it.each([undefined, null, 123, {}, "2026-10-02", "2026-10-02T12:00Z",
    "2026-10-02t12:00:00Z", "2026-10-02T12:00:00z", "2026-10-02T12:00:00",
    "2026-10-02T12:00:00-00:00", "2026-10-02T12:00:00+2400", "2026-10-02T12:00:00+24:00",
    "2026-10-02T12:00:00+00:60", "2026-10-02T24:00:00Z", "2026-10-02T12:60:00Z",
    "2026-10-02T12:00:60Z", "2026-02-29T12:00:00Z", "2026-04-31T12:00:00Z",
    "2026-00-02T12:00:00Z", "2026-10-00T12:00:00Z", " 2026-10-02T12:00:00Z",
    `2026-10-02T12:00:00.${"1".repeat(128)}Z`,
  ])("does not normalize invalid or unsupported input %j", (value) => {
    expect(atprotoPostTime(value)).toBeNull();
  });
});
