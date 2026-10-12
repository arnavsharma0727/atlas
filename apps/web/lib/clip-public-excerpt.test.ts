import { describe, expect, it } from "vitest";
import { clipPublicExcerpt } from "./clip-public-excerpt";

describe("bounded public excerpts", () => {
  it("preserves short text exactly", () => {
    expect(clipPublicExcerpt("GPU prices are uncertain.", 300)).toBe("GPU prices are uncertain.");
  });
  it.each(["12345678", "12,345.67", "RTX4090", "1.23e+9", "2026-10-12", "-12345", "५६७८९"])("does not manufacture a partial numeric token from %s", (token) => {
    const prefix = "GPU cost is ";
    expect(clipPublicExcerpt(`${prefix}${token} today`, prefix.length + 3)).toBe("GPU cost is");
  });
  it("does not leave a dangling currency symbol", () => {
    expect(clipPublicExcerpt("Cost is $12345678", 12)).toBe("Cost is");
  });
  it("preserves combining marks and whole emoji sequences at the boundary", () => {
    expect(clipPublicExcerpt("GPU marche\u0301 next", 9)).toBe("GPU");
    expect(clipPublicExcerpt("GPU 👩‍👩‍👧‍👦 next", 8)).toBe("GPU");
  });
  it("can retain a bounded CJK prefix without requiring spaces", () => {
    const text = "半導体市場の需要と在庫を調べています。";
    const clipped = clipPublicExcerpt(text, 12);
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.length).toBeLessThanOrEqual(12);
    expect(text.startsWith(clipped)).toBe(true);
  });
  it("withholds a single overlong word rather than inventing a shortened word", () => {
    expect(clipPublicExcerpt("x".repeat(301), 300)).toBe("");
  });
  it("rejects invalid bounds", () => {
    for (const limit of [-1, 1.5, Infinity]) expect(() => clipPublicExcerpt("text", limit)).toThrow(RangeError);
  });
});
