const NUMBER = "[+-]?(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const CURRENCY = "(?:US\\$|USD|EUR|GBP|JPY|KRW|INR|CNY|RMB|BRL|\\$|€|£|¥|₹|₩)";
const SCALE = "(?:trillion|billion|million|thousand|tn|bn|mn)";
const UNIT = "(?:percentage\\s+points?|basis\\s+points?|percent|bps|%)";

/** Literal digit consistency, not arithmetic, a locale parser, or metric entailment. */
export function extractSummaryNumericTokens(value: string): string[] {
  // No lookbehind on letters: identifiers such as RTX4090 must retain the
  // entire number, rather than backtracking to a suffix such as 090 or 0.
  return (value.normalize("NFKC").replaceAll("−", "-").match(new RegExp(`${NUMBER}%?`, "gu")) ?? [])
    .map((token) => token.replaceAll(",", ""));
}

type Quantity = { number: string; signature: string };
function quantities(value: string): Quantity[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${CURRENCY})?\\s*(${NUMBER})\\s*(${SCALE})?\\s*(${UNIT})?\\s*(${CURRENCY})?(?![\\p{L}\\p{N}])`, "giu");
  return [...value.normalize("NFKC").replaceAll("−", "-").matchAll(pattern)].flatMap((match) => {
    const normalize = (text: string | undefined) => (text ?? "").toLowerCase().replace(/\s+/gu, " ").trim();
    const prefix = normalize(match[1]);
    const suffix = normalize(match[5]);
    const scale = normalize(match[3]);
    const unit = normalize(match[4]);
    if (!prefix && !suffix && !scale && !unit) return [];
    const number = match[2].replaceAll(",", "");
    // Literal qualifiers only: no currency, percent/bps, scale or locale conversion.
    return [{ number, signature: JSON.stringify([number, prefix, scale, unit, suffix]) }];
  });
}

export type NumericSupportFailure = "number-not-quoted" | "quantity-unit-mismatch";

/** All numbers must be inspectable in the claim's displayed support, not hidden elsewhere. */
export function summaryNumericSupportFailure(claim: string, quotes: readonly string[]): NumericSupportFailure | null {
  const tokens = extractSummaryNumericTokens(claim);
  const quotedTokens = new Set(quotes.flatMap(extractSummaryNumericTokens));
  if (tokens.some((token) => !quotedTokens.has(token))) return "number-not-quoted";
  const claimQuantities = quantities(claim);
  const quoteQuantities = quotes.flatMap(quantities);
  const quoteSignatures = new Set(quoteQuantities.map(({ signature }) => signature));
  if (claimQuantities.some(({ signature }) => !quoteSignatures.has(signature))) return "quantity-unit-mismatch";
  // Do not silently drop an explicit unit/scale from an otherwise matching figure.
  const typedClaimNumbers = new Set(claimQuantities.map(({ number }) => number));
  const typedQuoteNumbers = new Set(quoteQuantities.map(({ number }) => number));
  if (tokens.some((token) => typedQuoteNumbers.has(token.replace(/%$/u, "")) && !typedClaimNumbers.has(token.replace(/%$/u, "")))) return "quantity-unit-mismatch";
  return null;
}
