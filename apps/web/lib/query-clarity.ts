const ALIASES: Record<string, string> = {
  AAPL: "Apple Inc.",
  AMZN: "Amazon",
  ARM: "Arm Holdings",
  CAT: "Caterpillar",
  COIN: "Coinbase",
  EV: "electric vehicle",
  GOOGL: "Alphabet",
  GOOG: "Alphabet",
  HOOD: "Robinhood Markets",
  AI: "artificial intelligence",
  META: "Meta Platforms",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  ORCL: "Oracle",
  PLTR: "Palantir Technologies",
  TSLA: "Tesla",
};

export type QueryClarity = {
  isAmbiguous: boolean;
  warning: string | null;
  suggestedAlias: string | null;
};

/** Suggests a common expansion for the researcher to choose; never changes a query itself. */
export function inspectQueryClarity(input: string): QueryClarity {
  const query = input.normalize("NFKC").trim();
  const tokenMatches = [...query.matchAll(/\$?[A-Za-z]{1,5}/g)];
  const aliasTokens = tokenMatches.filter((match) => {
    const raw = match[0].replace(/^\$/, "");
    const explicitTicker = match[0].startsWith("$") || raw === raw.toLocaleUpperCase();
    return explicitTicker && ALIASES[raw.toLocaleUpperCase()];
  });
  const suggestedAlias = aliasTokens.length === 1
    ? replaceRange(query, aliasTokens[0].index!, aliasTokens[0][0].length, ALIASES[aliasTokens[0][0].replace(/^\$/, "").toLocaleUpperCase()])
    : null;
  const tickerLike = /^\$?[A-Z]{1,5}$/.test(query);
  const broadCommonTerm = /^(ai|ev|cat|meta|apple|coin|arm)$/i.test(query);
  const isAmbiguous = tickerLike || broadCommonTerm || aliasTokens.length > 0;
  return {
    isAmbiguous,
    warning: isAmbiguous
      ? "This short or ticker-like phrase may match an ordinary word, acronym, or different entity. Atlas searches the phrase as entered and does not infer a company or market meaning; add company/concept words or choose the explicit suggestion below."
      : null,
    suggestedAlias,
  };
}

function replaceRange(value: string, start: number, length: number, replacement: string) {
  return `${value.slice(0, start)}${replacement}${value.slice(start + length)}`;
}
