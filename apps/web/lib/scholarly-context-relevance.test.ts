import { describe, expect, it } from "vitest";
import { matchesScholarlyContext, scholarlyContextNote } from "./scholarly-context-relevance";

describe("bounded scholarly wrong-sense screening", () => {
  it.each([
    ["Inflation and consumer prices", "", ""],
    ["Inflation persistence", "Journal of Monetary Economics", ""],
    ["Inflation", "", "econ.GN"],
    ["Inflation", "", "q-fin.EC"],
    ["Inflation and household expectations", "", "physics.soc-ph"],
  ])("retains positive economic metadata: %s", (title, journal, category) => {
    expect(matchesScholarlyContext("inflation", title, journal, category)).toBe(true);
  });
  it.each([
    ["Cosmological inflation and prices", "Economics", "econ.GN"],
    ["Quantum inflation: a Python library", "", "quant-ph"],
    ["Scalar field inflation", "", "astro-ph.CO"],
    ["Inflation", "", ""],
    ["Inflation", "Macroeconomically interesting", ""],
  ])("rejects physical or unresolved sense: %s", (title, journal, category) => {
    expect(matchesScholarlyContext("inflation", title, journal, category)).toBe(false);
  });
  it("does not override an explicitly requested scientific sense or unrelated query", () => {
    expect(matchesScholarlyContext("cosmic inflation", "Cosmic inflation")).toBe(true);
    expect(matchesScholarlyContext("semiconductor", "Semiconductor physics")).toBe(true);
    expect(scholarlyContextNote("cosmic inflation")).toBe("");
  });
  it("normalizes full-width text and discloses narrow English-only recall limits", () => {
    expect(matchesScholarlyContext("ｉｎｆｌａｔｉｏｎ", "Inflation and consumer prices")).toBe(true);
    expect(matchesScholarlyContext("deflation", "Deflation and monetary policy")).toBe(true);
    expect(scholarlyContextNote("inflation")).toContain("English-only");
    expect(scholarlyContextNote("inflation")).toContain("bounded upstream");
  });
});
