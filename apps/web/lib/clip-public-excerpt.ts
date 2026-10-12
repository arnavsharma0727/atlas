const wordSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("en", { granularity: "word" })
  : null;

/** Bounded prefix of whole word segments, not a semantic or sentence summary. */
export function clipPublicExcerpt(value: string, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid excerpt limit");
  if (value.length <= limit) return value;
  // Unsupported runtimes must not silently fall back to manufacturing partial
  // numbers/words. Short text remains usable; long previews are withheld.
  if (!wordSegmenter || limit === 0) return "";
  let end = 0;
  for (const part of wordSegmenter.segment(value)) {
    const nextEnd = part.index + part.segment.length;
    if (nextEnd > limit) break;
    end = nextEnd;
  }
  // Word segmentation may split scientific notation, dates, signed ranges or
  // identifier punctuation. Never retain part of a numeric-bearing whitespace
  // token even when the segmenter regards that position as a word boundary.
  let tokenStart = end;
  let tokenEnd = end;
  while (tokenStart > 0 && !/\s/u.test(value[tokenStart - 1])) tokenStart--;
  while (tokenEnd < value.length && !/\s/u.test(value[tokenEnd])) tokenEnd++;
  if (tokenStart < end && tokenEnd > end && /\p{N}/u.test(value.slice(tokenStart, tokenEnd))) end = tokenStart;
  // Avoid leaving a dangling currency symbol when its number was withheld.
  return value.slice(0, end).trimEnd().replace(/[$€£¥₹₩]$/u, "").trimEnd();
}
