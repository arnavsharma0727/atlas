import { citationKey } from "./perspective-snapshot";
import type { ResearchSweepSourceResult } from "./research-sweep";
import { publicationTimestampUTC } from "./publication-date";
import { extractSummaryNumericTokens, summaryNumericSupportFailure } from "./summary-numeric-support";
import { clipPublicExcerpt } from "./clip-public-excerpt";

export type SummarySupportQuote = { citationId: string; quote: string };
export type SummaryClaim = { text: string; citations: string[]; supportingQuotes?: SummarySupportQuote[] };
export type SummaryPassage = SummaryClaim & { claims?: SummaryClaim[] };
const MIN_VERBATIM_COPY_REJECTION_CHARS = 160;
export type MarketSummary = {
  usSummary: SummaryPassage;
  localSummary: SummaryPassage;
  comparison: SummaryPassage;
  limitations: string[];
  groundingCheck?: { state: "model-check-passed"; claimCount: number; independentValidation: false };
};

export type ModelEvidence = {
  citationId: string;
  source: string;
  title: string;
  excerpt: string;
  language: string;
  /** Unverified provider/client metadata, never evidence of the underlying event date. */
  reportedPostedAt?: string;
  linkSharing?: boolean;
};

export type EvidenceBreadth = { excerptCount: number; platformLabels: string[] };

/** Count distinct source platforms in the exact excerpt set sent to the overview. */
export function summarizeEvidenceBreadth(evidence: readonly Pick<ModelEvidence, "source">[]): EvidenceBreadth {
  const labels = new Set<string>();
  for (const { source } of evidence) {
    const normalized = source.trim().replace(/\s+/gu, " ");
    const knownNetwork = normalized.match(/^(Bluesky|Mastodon|Lemmy|Stack Exchange|Hacker News|Global Voices|The Conversation)\b/iu)?.[1];
    labels.add(knownNetwork ? knownNetwork.replace(/\b\p{L}/u, (letter) => letter.toLocaleUpperCase()) : normalized.split(" · ", 1)[0]);
  }
  return { excerptCount: evidence.length, platformLabels: [...labels].filter(Boolean).sort((a, b) => a.localeCompare(b)) };
}

/** Count only originals actually referenced by a passage, not all selected model inputs. */
export function summarizeCitedEvidenceBreadth(
  results: ResearchSweepSourceResult[],
  citationIds: Map<string, string>,
  references: readonly string[],
): EvidenceBreadth {
  const citedIds = new Set(references);
  const originals = new Set<string>();
  const cited: Array<Pick<ModelEvidence, "source">> = [];
  for (const result of results) for (const item of result.evidence) {
    const id = citationIds.get(citationKey(result.key, item.id));
    if (!id || !citedIds.has(id)) continue;
    const original = normalizeSourceUrl(item.url);
    if (originals.has(original)) continue;
    originals.add(original);
    cited.push({ source: item.source });
  }
  return summarizeEvidenceBreadth(cited);
}

/** Keep a one-source summary from reading like a cross-community result. */
export function evidenceBreadthWarning(breadth: EvidenceBreadth): string | null {
  if (breadth.platformLabels.length === 0) {
    return "No text-bearing excerpts passed the overview filters for this side; its cross-community view cannot be assessed.";
  }
  if (breadth.platformLabels.length === 1) {
    return `Single-platform sample (${breadth.platformLabels[0]}); this is not a cross-community view.`;
  }
  return null;
}

const MARKET_SIGNAL_TERMS: Record<string, RegExp> = {
  en: /\b(?:markets?|demand|supply|prices?|pricing|sales|revenue|margins?|inventory|inventories|stocks?|shares?|invest(?:ors?|ing|ments?)?|bullish|bearish|earnings|profits?|loss(?:es)?|tariffs?|exports?|imports?|production|yields?|harvests?|commodity|commodities|futures|valuations?|customer churn|market share|interest rates?|bond yields?|supply chain|order book|capital expenditure|guidance|cash flow|dividends?|debt|equity)\b/iu,
  pt: /\b(?:mercado|demanda|oferta|preço|preços|vendas|receita|faturamento|margem|estoque|ações|investimento|investidor|lucro|prejuízo|tarifa|exportação|importação|produção|safra|commodit\w*|futuro|cotação|taxa de juros|câmbio|bolsa de valores|rendimento|dividendo|capitalização)\b/iu,
  es: /\b(?:mercado|demanda|oferta|precio|precios|ventas|ingresos|margen|inventario|acciones|inversión|inversor|beneficio|pérdida|arancel|exportación|importación|producción|cosecha|materias primas|futuros|cotización|tipo de cambio|tasa de interés|bolsa de valores|rentabilidad|dividendo|capitalización)\b/iu,
  fr: /\b(?:marché|demande|offre|prix|ventes|revenu|chiffre d['’]affaires|marge|stock|actions|investissement|investisseur|bénéfice|perte|tarif|exportation|importation|production|récolte|matières premières|contrats à terme|valorisation|taux d'intérêt|cours boursier|rendement|dividende|capitalisation)\b/iu,
  de: /\b(?:markt|nachfrage|angebot|preis|preise|preislich|preisentwicklung|kosten|umsatz|marge|lagerbestand|aktie|investition|investor|gewinn|verlust|zoll|export|import|produktion|ernte|rohstoff|terminmarkt|bewertung|aktienkurs|börsenkurs|zinssatz|rendite|dividende|marktkapitalisierung|cashflow|auftragsbestand)\b/iu,
  ko: /(?:시장|수요|공급|가격|매출|마진|재고|주가|주식|투자|실적|이익|손실|관세|수출|수입|생산|수확|원자재|선물|밸류에이션|시가총액|영업이익|배당|금리|환율|주주|공급망|가이던스)/u,
  ja: /(?:市場|需要|供給|価格|売上|利益|在庫|株価|株式|投資|業績|関税|輸出|輸入|生産|収穫|原材料|先物|評価額|時価総額|株主|営業利益|配当|金利|為替|供給網|売上高|業績予想)/u,
  hi: /(?:बाज़ार|बाजार|मांग|आपूर्ति|कीमत|बिक्री|राजस्व|मुनाफ़ा|मुनाफा|शेयर|निवेश|लाभ|नुकसान|टैरिफ़|टैरिफ|निर्यात|आयात|उत्पादन|फ़सल|फसल|कमोडिटी|ब्याज दर|विनिमय दर|शेयर बाज़ार|शेयर बाजार|बाज़ार पूंजीकरण|बाजार पूंजीकरण|लाभांश|आपूर्ति श्रृंखला|मूल्यांकन)/u,
};

// JavaScript \b uses ASCII-style word characters even with the Unicode flag:
// it misses a final é in marché and can match price inside éprice. Preserve
// the reviewed vocabulary while making only its outer word boundaries Unicode-aware.
const UNICODE_MARKET_SIGNAL_TERMS: Record<string, RegExp> = Object.fromEntries(
  Object.entries(MARKET_SIGNAL_TERMS).map(([language, pattern]) => [language,
    ["en", "pt", "es", "fr", "de"].includes(language)
      ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${pattern.source.slice(2, -2)}(?![\\p{L}\\p{M}\\p{N}_])`, pattern.flags)
      : pattern,
  ]),
);

function macroWords(terms: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${terms})(?![\\p{L}\\p{M}\\p{N}_])`, "iu");
}

/** Core macro concepts can carry market meaning without saying price or stock. */
const MACRO_SIGNAL_TERMS: Record<string, RegExp> = {
  en: macroWords("inflation|deflation|unemployment|recession|gdp|gross domestic product|monetary policy|central bank|mortgage rates?|borrowing costs?"),
  fr: macroWords("inflation|déflation|chômage|récession|pib|produit intérieur brut|politique monétaire|banque centrale"),
  de: macroWords("inflation|inflationsrate|deflation|arbeitslosigkeit|arbeitslosenquote|rezession|bip|bruttoinlandsprodukt|geldpolitik|zentralbank"),
  es: macroWords("inflación|deflación|desempleo|recesión|pib|producto interior bruto|producto interno bruto|política monetaria|banco central"),
  pt: macroWords("inflação|deflação|desemprego|recessão|pib|produto interno bruto|política monetária|banco central"),
  ko: /(?:인플레이션|디플레이션|물가|실업|경기침체|경기 침체|국내총생산|통화정책|통화 정책|중앙은행)/u,
  ja: /(?:インフレ|デフレ|失業|景気後退|国内総生産|金融政策|中央銀行)/u,
  hi: /(?:मुद्रास्फीति|महंगाई|बेरोजगारी|मंदी|सकल घरेलू उत्पाद|मौद्रिक नीति|केंद्रीय बैंक)/u,
};

const QUERY_INTENT_TERMS = new Set([
  "a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with",
  "market", "markets", "marketplace", "price", "prices", "pricing", "demand", "supply",
  "sales", "revenue", "margin", "margins", "inventory", "inventories", "stock", "stocks",
  "share", "shares", "invest", "investor", "investors", "investment", "investments",
  "earnings", "profit", "profits", "loss", "losses", "tariff", "tariffs", "export", "exports",
  "import", "imports", "production", "yield", "yields", "commodity", "commodities", "futures",
  "valuation", "valuations", "guidance", "cash", "flow", "dividend", "dividends", "debt", "equity",
  "interest", "rate", "rates", "bond", "bonds", "chain", "order", "book", "capital", "expenditure",
  "mercado", "mercados", "demanda", "oferta", "preço", "preços", "precio", "precios", "prix", "marché", "nachfrage", "angebot", "markt", "preis", "preise",
  "mercati", "domanda", "offerta", "prezzi", "prezzo", "marknaden", "efterfrågan", "anbud", "kurs", "kursen",
  "수요", "공급", "시장", "가격", "매출", "주가", "주식", "투자", "실적", "이익", "손실", "수출", "수입", "생산", "원자재", "선물", "시가총액", "영업이익", "배당", "금리", "환율", "주주", "공급망", "가이던스",
  "需要", "供給", "市場", "価格", "売上", "利益", "在庫", "株価", "株式", "投資", "業績", "関税", "輸出", "輸入", "生産", "原材料", "先物", "時価総額", "営業利益", "配当", "金利", "為替", "株主", "供給網",
  "बाज़ार", "बाजार", "मांग", "आपूर्ति", "कीमत", "बिक्री", "राजस्व", "शेयर", "निवेश", "लाभ", "हानि", "निर्यात", "आयात", "उत्पादन", "फसल", "कमोडिटी", "ब्याज", "विनिमय", "लाभांश",
]);

const MARKET_TOPIC_ALIASES: string[][] = [
  // Curated adjacent sector wording. This is a discovery alias, not evidence
  // that a post about photovoltaic generation discusses panel manufacturers.
  ["solar panel", "solar panels", "solar module", "solar modules", "photovoltaic", "photovoltaics", "solarmodul", "solarmodule", "photovoltaik"],
  ["semiconductor", "semiconductors", "chip", "chips", "gpu", "gpus", "wafer", "wafers"],
  ["oil", "crude", "petroleum", "brent", "wti"],
  ["natural gas", "gas natural", "gás natural", "gaz naturel", "erdgas", "천연가스", "천연 가스", "天然ガス", "प्राकृतिक गैस", "lng", "henry hub"],
  ["bitcoin", "btc"],
  ["ethereum", "ether", "eth"],
  ["electric vehicle", "electric vehicles", "ev", "evs", "voiture électrique", "voitures électriques", "voiture electrique", "voitures electriques", "carro elétrico", "carros elétricos", "coche eléctrico", "coches eléctricos", "elektroauto", "elektroautos"],
];

const NATURAL_GAS_QUERY_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])natural\s+gas(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])gas\s+natural(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])gás\s+natural(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])gaz\s+naturel(?:$|[^\p{L}\p{N}])/u,
  /erdgas\p{L}*/u,
  /천연\s*가스/u,
  /天然ガス/u,
  /प्राकृतिक\s+गैस/u,
];
const NATURAL_GAS_EVIDENCE_PATTERNS = [
  ...NATURAL_GAS_QUERY_PATTERNS,
  /(?:^|[^\p{L}\p{N}])lng(?:$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])henry\s+hub(?:$|[^\p{L}\p{N}])/iu,
];

/** Require evidence to mention the searched subject, not merely generic market vocabulary. */
export function hasTopicSignalTerms(excerpt: string, topic: string): boolean {
  const normalizedExcerpt = excerpt.normalize("NFKC").toLocaleLowerCase();
  const normalizedTopic = topic.normalize("NFKC").toLocaleLowerCase();
  const isNaturalGasQuery = NATURAL_GAS_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedTopic));
  if (isNaturalGasQuery && !NATURAL_GAS_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalizedExcerpt))) return false;
  // Resolve the gas concept without discarding other subjects in the query.
  // Include combining marks so Hindi words remain intact rather than fragments.
  const remainingTopic = isNaturalGasQuery
    ? NATURAL_GAS_QUERY_PATTERNS.reduce((value, pattern) => value.replace(pattern, " "), normalizedTopic)
    : normalizedTopic;
  const topicTerms = (remainingTopic.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .filter((term) => !QUERY_INTENT_TERMS.has(term));
  const matches = (term: string) => {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term)) return normalizedExcerpt.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{M}\\p{N}])`, "iu").test(normalizedExcerpt);
  };
  if (!topicTerms.length) return isNaturalGasQuery;

  // A reviewed alias group is one concept: "semiconductor" may be written
  // as "GPU", but a separate query concept (e.g. a company name) must also
  // be present. Requiring every independent concept avoids admitting a post
  // merely because it contains a generic word from a multi-part query.
  const requiredAliasGroups = new Set<number>();
  const aliasConceptTerms = new Set<string>();
  for (const [index, group] of MARKET_TOPIC_ALIASES.entries()) {
    for (const alias of group) {
      const aliasTerms = alias.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
      const isQueryAlias = aliasTerms.length === 1
        ? topicTerms.includes(aliasTerms[0])
        : aliasTerms.every((term) => topicTerms.includes(term)) && normalizedTopic.includes(alias);
      if (!isQueryAlias) continue;
      requiredAliasGroups.add(index);
      aliasTerms.forEach((term) => aliasConceptTerms.add(term));
    }
  }
  const requiredTerms = topicTerms.filter((term) => !aliasConceptTerms.has(term));
  const aliasesMatch = [...requiredAliasGroups].every((index) => MARKET_TOPIC_ALIASES[index].some(matches));
  return aliasesMatch && requiredTerms.every(matches);
}

/** High-confidence stock-pitch patterns are visible source material, not independent community views. */
export function isLikelyMarketPromotion(value: string): boolean {
  const text = value.normalize("NFKC");
  const patterns = [
    /\b(?:top|best)\s+\d+\s+(?:stocks?|shares?)\s+(?:to\s+)?buy\b/iu,
    /\b\d+\s+(?:reasons|ways)\b.{0,60}\b(?:buy|stock|shares?|profit|rally)\b/iu,
    /\b(?:price target|target price|stock forecast|stock prediction|buy recommendation|guaranteed returns?)\b/iu,
    /(?:garantierte rendite|kaufempfehlung|top\s+\d+\s+aktien\s+(?:zum\s+)?kaufen)/iu,
    /(?:rendement garanti|recommandation d['’]achat|meilleures actions à acheter)/iu,
    /(?:rentabilidad garantizada|recomendación de compra|mejores acciones para comprar)/iu,
    /(?:rentabilidade garantida|recomendação de compra|melhores ações para comprar)/iu,
    /(?:गारंटीड रिटर्न|शेयर खरीदने की सिफारिश|खरीदने के लिए सर्वश्रेष्ठ शेयर)/u,
    /(?:목표주가|목표가|주가\s*전망|수혜주|매수\s*추천|투자\s*전략|\d+\s*가지\s*이유|찍을\s*수밖에|전고점.{0,20}(?:뚫을|뚫고|돌파))/u,
    /(?:目標株価|株価予想|買い推奨|投資戦略)/u,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

/** Explicit publisher attribution marks a social excerpt as a report/share, not an independent view. */
export function isAttributedReportShare(value: string): boolean {
  return /(?:\bsource\s*:\s*|\bvia\s*:\s*|\breported\s+by\s*:\s*|出典\s*[:：]|출처\s*[:：])[^\s,;]{2,80}/iu.test(value);
}

/** A country-labelled, star-wrapped bulletin is not a first-person market view. */
export function isHeadlineBulletin(value: string): boolean {
  return /^\s*\*(?:[^*\n]{1,32}\s+-\s+[^*\n]{12,180})\*/u.test(value.normalize("NFKC"));
}

/** Personal purchase/utility-bill advice is not evidence of a market-wide view. */
export function isHouseholdPurchaseAdvice(value: string): boolean {
  const text = value.normalize("NFKC");
  return /\b(?:my|your|our|their|his|her)\s+(?:own\s+)?(?:electric(?:ity)?|energy|utility|power)\s+bills?\b/iu.test(text) ||
    /\b(?:my|your|our)\s+own\s+(?:solar\s+panels?|home\s+batter(?:y|ies)|rooftop\s+solar)\b/iu.test(text) ||
    /\b(?:mein(?:e|er|en|em|es)?|unser(?:e|er|en|em|es)?|dein(?:e|er|en|em|es)?)\s+(?:stromrechnung|energiekosten|solarmodule?|photovoltaikanlage|pv-anlage)\b/iu.test(text) ||
    /\b(?:erstes?|zweites?|drittes?)\s+angebot\b.{0,140}\b(?:elektriker|wallbox|haus|dach)\b/iu.test(text);
}

/** Linked, explicitly attributed, or high-confidence promotional posts cannot support the overview. */
export function isIndependentDiscussionEvidence(item: { linkSharing?: boolean; excerpt?: string }): boolean {
  const excerpt = item.excerpt ?? "";
  return item.linkSharing !== true && !isLikelyMarketPromotion(excerpt) && !isAttributedReportShare(excerpt) && !isHeadlineBulletin(excerpt) && !isHouseholdPurchaseAdvice(excerpt);
}

/** Filter displayed records by the phrase actually used for each search lens, preserving raw API counts. */
export function filterResultsToTopic(
  results: ResearchSweepSourceResult[],
  baselineTopic: string,
  localTopic = baselineTopic,
  expectedLocalLanguage?: string,
): ResearchSweepSourceResult[] {
  return results.map((result) => {
    const topic = result.key.startsWith("local:") ? localTopic : baselineTopic;
    const evidence = result.evidence.filter((item) =>
      ((result.key === "world-bank-macro" || result.key === "eia-energy-prices" || result.key === "bis-effective-exchange" || result.key === "ecb-reference") && item.evidenceClass === "official statistical data") ||
      hasTopicSignalTerms(`${item.title} ${item.transientPreview ?? ""}`, topic),
    ).map((item) => {
      const copy = `${item.title} ${item.transientPreview ?? ""}`;
      const isPromotion = isLikelyMarketPromotion(copy);
      const isReportShare = isAttributedReportShare(copy);
      const isBulletin = isHeadlineBulletin(item.transientPreview ?? item.title);
      const isHouseholdAdvice = isHouseholdPurchaseAdvice(copy);
      const detectedLanguage = result.key.startsWith("local:") && expectedLocalLanguage
        ? languageLensMatchMethod(item.language, expectedLocalLanguage, item.transientPreview ?? item.title)
        : null;
      if ((item.evidenceClass !== "social discussion" || (!isPromotion && !isReportShare && !isBulletin && !isHouseholdAdvice)) && detectedLanguage !== "script-detection") return item;
      return {
        ...item,
        context: [item.context, detectedLanguage === "script-detection"
          ? `Provider language was missing or unmapped; this excerpt matched the selected ${expectedLocalLanguage} language lens by script only. This does not establish poster location or nationality.`
          : undefined, isPromotion
          ? "This excerpt matches a high-confidence stock-promotion/clickbait phrase screen; it remains visible but is excluded from the AI overview."
          : isReportShare
            ? "This post explicitly attributes its material to a publisher; it remains visible but is excluded as an independent community view."
            : isBulletin
              ? "This post uses a country-labelled headline-bulletin format; it remains visible but is excluded as an independent community view."
            : isHouseholdAdvice
              ? "This post gives individual household purchase or utility-bill advice; it remains visible but does not support a market-wide discussion overview."
            : undefined].filter(Boolean).join(" "),
      };
    });
    const newlyExcluded = result.evidence.length - evidence.length;
    return {
      ...result,
      evidence,
      providerReturnedCount: result.providerReturnedCount ?? result.evidence.length,
      topicExcludedCount: (result.topicExcludedCount ?? 0) + newlyExcluded,
    };
  });
}

/**
 * Conservative lexical screen for discussion snippets sent to AI. It is not
 * a semantic relevance classifier: a match is only a minimum vocabulary gate.
 */
export function hasMarketSignalTerms(item: Pick<ModelEvidence, "excerpt" | "language">): boolean {
  const normalizedLanguage = item.language.trim().toLocaleLowerCase().split(/[-_]/u, 1)[0];
  const language = LANGUAGE_NAMES[normalizedLanguage] ?? normalizedLanguage;
  const matcher = UNICODE_MARKET_SIGNAL_TERMS[language];
  const excerpt = item.excerpt.normalize("NFKC");
  return matcher
    ? matcher.test(excerpt) || MACRO_SIGNAL_TERMS[language].test(excerpt)
    : [...Object.values(UNICODE_MARKET_SIGNAL_TERMS), ...Object.values(MACRO_SIGNAL_TERMS)].some((candidate) => candidate.test(excerpt));
}

/** Remove direct links, emails, and @handles before a short discussion excerpt is sent to the model. */
export function redactSummaryExcerpt(value: string): string {
  return clipPublicExcerpt(value.normalize("NFKC")
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/giu, "[link]")
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, "[email]")
    .replace(/(^|[^\p{L}\p{N}_])@[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}/gu, "$1[handle]")
    .replace(/\s+/g, " ")
    .trim(), 300);
}

/** Dataset pages contain multiple observations; a shared URL is not a shared row. */
function sourceRecordIdentity(item: ResearchSweepSourceResult["evidence"][number]): string {
  return item.evidenceClass === "official statistical data" && item.id.trim()
    ? `observation\u0000${item.sourceOperatorKey ?? item.source}\u0000${item.id}`
    : `url\u0000${normalizeSourceUrl(item.url)}`;
}

/** Preserve provider return counts while flagging records repeated across query/server views. */
export function flagRepeatedEvidenceViews(results: ResearchSweepSourceResult[]): ResearchSweepSourceResult[] {
  const recordViews = new Map<string, Set<string>>();
  const textViews = new Map<string, Set<string>>();
  const crossOperatorTextViews = new Map<string, Map<string, Set<string>>>();
  const nearDuplicateItems = new Set<string>();
  const crossOperatorNearDuplicateItems = new Set<string>();
  const longTextItems: Array<{ operator: string; itemKey: string; text: string }> = [];
  const textItemsByOperator = new Map<string, Array<{ resultKey: string; itemKey: string; text: string }>>();
  for (const result of results) {
    for (const item of result.evidence) {
      const operator = item.sourceOperatorKey ?? item.source;
      const recordKey = sourceRecordIdentity(item);
      const text = item.evidenceClass === "official statistical data" ? "" : (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const textKey = text ? `${operator}\u0000text\u0000${text}` : "";
      if (text) {
        if (text.length >= 80) {
          const operators = crossOperatorTextViews.get(text) ?? new Map<string, Set<string>>();
          const views = operators.get(operator) ?? new Set<string>();
          views.add(`${result.key}\u0000${item.id}`);
          operators.set(operator, views);
          crossOperatorTextViews.set(text, operators);
        }
        if (text.length >= 120) longTextItems.push({ operator, itemKey: `${result.key}\u0000${item.id}`, text });
        const rows = textItemsByOperator.get(operator) ?? [];
        rows.push({ resultKey: result.key, itemKey: `${result.key}\u0000${item.id}`, text });
        textItemsByOperator.set(operator, rows);
      }
      addView(recordViews, recordKey, result.key);
      if (textKey) addView(textViews, textKey, result.key);
    }
  }
  for (const rows of textItemsByOperator.values()) {
    for (let left = 0; left < rows.length; left++) {
      for (let right = left + 1; right < rows.length; right++) {
        if (!isNearDuplicateExcerpt(rows[left].text, rows[right].text)) continue;
        nearDuplicateItems.add(rows[left].itemKey);
        nearDuplicateItems.add(rows[right].itemKey);
      }
    }
  }
  for (let left = 0; left < longTextItems.length; left++) {
    for (let right = left + 1; right < longTextItems.length; right++) {
      if (longTextItems[left].operator === longTextItems[right].operator) continue;
      if (!isNearDuplicateExcerpt(longTextItems[left].text, longTextItems[right].text)) continue;
      crossOperatorNearDuplicateItems.add(longTextItems[left].itemKey);
      crossOperatorNearDuplicateItems.add(longTextItems[right].itemKey);
    }
  }
  return results.map((result) => {
    let repeated = 0;
    const evidence = result.evidence.map((item) => {
      const operator = item.sourceOperatorKey ?? item.source;
      const recordViewsForItem = recordViews.get(sourceRecordIdentity(item));
      const text = item.evidenceClass === "official statistical data" ? "" : (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const textViewsForItem = textViews.get(`${operator}\u0000text\u0000${text}`);
      const crossOperatorViews = text.length >= 80 ? crossOperatorTextViews.get(text) : undefined;
      const crossOperatorDuplicate = (crossOperatorViews?.size ?? 0) > 1;
      const nearDuplicate = nearDuplicateItems.has(`${result.key}\u0000${item.id}`);
      const crossOperatorNearDuplicate = crossOperatorNearDuplicateItems.has(`${result.key}\u0000${item.id}`);
      const otherViews = Math.max(recordViewsForItem?.size ?? 0, textViewsForItem?.size ?? 0) - 1;
      if (otherViews < 1 && !nearDuplicate && !crossOperatorDuplicate && !crossOperatorNearDuplicate) return item;
      repeated += 1;
      const reason = recordViewsForItem && recordViewsForItem.size > 1
        ? `Same source ${item.evidenceClass === "official statistical data" ? "observation" : "URL"} appears in ${recordViewsForItem.size} query/server views; repeated appearances are not independent evidence.`
        : crossOperatorDuplicate
          ? "Exact long-form text appears across multiple source operators; it may be cross-posted and is not independent corroboration."
          : crossOperatorNearDuplicate
            ? "Near-identical long-form text appears across different source operators; it may be syndicated or cross-posted and is not independent corroboration."
          : textViewsForItem && textViewsForItem.size > 1
          ? `Exact normalized text appears in ${textViewsForItem.size} query/server views; repeated appearances are not independent corroboration.`
          : "Near-identical long-form text appears in another record from the same source network; treat it as a possible copy, not independent corroboration.";
      return { ...item, context: [item.context, reason].filter(Boolean).join(" ") };
    });
    const overlapNote = repeated
      ? `Possible duplication: ${repeated} of ${result.evidence.length} returned records duplicate or closely resemble other evidence; copies are not independent corroboration.`
      : undefined;
    return {
      ...result,
      evidence,
      ...(overlapNote ? { sourceNote: [result.sourceNote, overlapNote].filter(Boolean).join(" ") } : {}),
    };
  });
}

export type DisplayEvidenceView = {
  result: ResearchSweepSourceResult;
  evidence: ResearchSweepSourceResult["evidence"];
  returnedCount: number;
  duplicateCount: number;
};

/** Collapse exact repeats within one provider/network for display, without changing raw results or citations. */
export function collapseRepeatedEvidenceViews(results: ResearchSweepSourceResult[]): DisplayEvidenceView[] {
  const canonical = new Map<string, { resultIndex: number; itemIndex: number }>();
  const suppressed = new Set<string>();
  const notes = new Map<string, Set<string>>();
  const duplicateCounts = results.map(() => 0);
  results.forEach((result, resultIndex) => {
    result.evidence.forEach((item, itemIndex) => {
      const operator = item.sourceOperatorKey ?? item.source;
      const normalizedText = (item.transientPreview ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
      const keys = item.url.trim() ? [`${operator}\u0000${sourceRecordIdentity(item)}`] : [];
      if (item.evidenceClass !== "official statistical data" && normalizedText.length >= 80) keys.push(`${operator}\u0000text\u0000${normalizedText}`);
      const prior = keys.map((key) => canonical.get(key)).find(Boolean);
      if (!prior) {
        const entry = { resultIndex, itemIndex };
        keys.forEach((key) => canonical.set(key, entry));
        return;
      }
      duplicateCounts[resultIndex]++;
      suppressed.add(`${resultIndex}\u0000${itemIndex}`);
      const canonicalResult = results[prior.resultIndex];
      const relatedLabel = result.label === canonicalResult.label ? "another selected query view" : result.label;
      const key = `${prior.resultIndex}\u0000${prior.itemIndex}`;
      const labels = notes.get(key) ?? new Set<string>();
      labels.add(relatedLabel);
      notes.set(key, labels);
    });
  });
  return results.map((result, resultIndex) => ({
    result,
    returnedCount: result.providerReturnedCount ?? result.evidence.length,
    duplicateCount: duplicateCounts[resultIndex],
    evidence: result.evidence.flatMap((item, itemIndex) => {
      if (suppressed.has(`${resultIndex}\u0000${itemIndex}`)) return [];
      const labels = notes.get(`${resultIndex}\u0000${itemIndex}`);
      if (!labels?.size) return [item];
      return [{ ...item, context: [item.context, `Also returned in ${[...labels].join(", ")}; this is one original record, not independent corroboration.`].filter(Boolean).join(" ") }];
    }),
  }));
}

function addView(map: Map<string, Set<string>>, key: string, resultKey: string) {
  const views = map.get(key) ?? new Set<string>();
  views.add(resultKey);
  map.set(key, views);
}

/** Select a small, source-balanced set of transient excerpts with resolvable citations. */
export function selectBalancedEvidence(
  results: ResearchSweepSourceResult[],
  citationIds: Map<string, string>,
  limit = 8,
  excludedKeys = new Set<string>(),
  expectedLanguage?: string,
  isEligible: (evidence: ModelEvidence) => boolean = () => true,
  onIneligible?: () => void,
  onEligibleCandidate?: (sourceKey: string) => void,
): ModelEvidence[] {
  const sources = new Map<string, Array<ModelEvidence & { dedupeKeys: string[]; authorKey?: string }>>();
  const seenText = new Set<string>();
  const seenRecords = new Set<string>();
  // Only selected excerpts are published into excludedKeys. Reuse those long
  // texts when selecting the second lens, without penalizing unselected rows.
  const sharedTextPrefix = "cross-operator-text\u0000";
  const seenNearDuplicateText = [...excludedKeys]
    .filter((key) => key.startsWith(sharedTextPrefix))
    .map((key) => key.slice(sharedTextPrefix.length));

  for (const result of results) {
    for (const item of result.evidence) {
      if (item.summaryEligible === false) continue;
      if (expectedLanguage && !matchesLanguageLens(item.language, expectedLanguage, item.transientPreview ?? item.title)) continue;
      const redactedExcerpt = item.transientPreview ? redactSummaryExcerpt(item.transientPreview) : "";
      const excerpt = item.linkSharing && redactedExcerpt && !redactedExcerpt.includes("[link]")
        ? `${clipPublicExcerpt(redactedExcerpt, 290).trimEnd()} [link]`
        : redactedExcerpt;
      const citationId = citationIds.get(citationKey(result.key, item.id));
      if (!excerpt || !citationId || !/^C\d{1,4}$/.test(citationId)) continue;

      // Replicated federation copies can be linked below, but must not become
      // extra weight in an AI summary. Exact and conservative near-copies are
      // collapsed within this selection and against previously selected lenses.
      const operator = item.sourceOperatorKey ?? item.source;
      const normalizedText = excerpt.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
      const textKey = normalizedText.length >= 80
        ? `cross-operator-text\u0000${normalizedText}`
        : `${operator}\u0000text\u0000${normalizedText}`;
      const recordKey = `url\u0000${normalizeSourceUrl(item.url)}`;
      if (seenText.has(textKey) || seenRecords.has(recordKey) || excludedKeys.has(textKey) || excludedKeys.has(recordKey)) continue;
      if (seenNearDuplicateText.some((text) => isNearDuplicateExcerpt(normalizedText, text))) continue;
      seenText.add(textKey);
      seenRecords.add(recordKey);
      seenNearDuplicateText.push(normalizedText);

      const modelEvidence: ModelEvidence = {
        citationId,
        source: item.source.slice(0, 80),
        title: item.evidenceClass === "social discussion" ? "Public discussion post" : item.title.slice(0, 180),
        excerpt,
        language: item.language.slice(0, 24),
        ...(item.evidenceClass === "social discussion" && publicationTimestampUTC(item.timeValue) !== null
          ? { reportedPostedAt: item.timeValue } : {}),
        ...(item.linkSharing ? { linkSharing: true } : {}),
      };
      if (!isEligible(modelEvidence)) {
        onIneligible?.();
        continue;
      }
      onEligibleCandidate?.(result.key);
      // A prolific account must not occupy most of one provider's small
      // synthesis sample. This key is used only for selection and never sent
      // to the summarizer; unknown attribution remains uncapped.
      const authorKey = item.evidenceClass === "social discussion"
        ? item.attributionUrl?.trim().toLocaleLowerCase() || (item.attribution?.trim()
          ? `${operator}\u0000${item.attribution.trim().toLocaleLowerCase()}`
          : undefined)
        : undefined;
      const group = sources.get(operator) ?? [];
      group.push({ ...modelEvidence, dedupeKeys: [textKey, recordKey], authorKey });
      sources.set(operator, group);
    }
  }

  const selected: Array<ModelEvidence & { dedupeKeys: string[]; authorKey?: string }> = [];
  const selectedAuthors = new Set<string>();
  const buckets = [...sources.values()];
  while (selected.length < limit) {
    let added = false;
    for (const bucket of buckets) {
      let itemIndex = bucket.findIndex(({ authorKey }) => !authorKey || !selectedAuthors.has(authorKey));
      // Discard remaining same-author posts from this source bucket rather
      // than cycling them back into the sample on a later round.
      if (itemIndex < 0) {
        bucket.length = 0;
        continue;
      }
      const item = bucket.splice(itemIndex, 1)[0];
      if (!item) continue;
      selected.push(item);
      if (item.authorKey) selectedAuthors.add(item.authorKey);
      item.dedupeKeys.forEach((key) => excludedKeys.add(key));
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected.map(({ dedupeKeys: _dedupeKeys, authorKey: _authorKey, ...item }) => item);
}

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en", korean: "ko", japanese: "ja", german: "de",
  french: "fr", portuguese: "pt", hindi: "hi", spanish: "es",
};

/** Match provider language labels; use conservative script detection for Korean, Japanese, and Hindi when labels are missing/unmapped. */
export function languageLensMatchMethod(reported: string, expected: string, text = ""): "provider-label" | "script-detection" | null {
  const canonical = (value: string) => {
    const cleaned = value.trim().toLocaleLowerCase().replaceAll("_", "-");
    if (["", "und", "zxx", "xx", "unknown", "not provided", "unspecified", "n/a"].includes(cleaned)) return null;
    const named = LANGUAGE_NAMES[cleaned];
    if (named) return named;
    if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(cleaned)) return cleaned.split("-", 1)[0];
    return null;
  };
  const actualCode = canonical(reported);
  const expectedCode = canonical(expected);
  if (!expectedCode) return null;
  if (actualCode !== null) return actualCode === expectedCode ? "provider-label" : null;
  const letters = [...text.normalize("NFKC").matchAll(/\p{L}/gu)].length;
  if (!letters) return null;
  const hangul = [...text.matchAll(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/gu)].length;
  const kana = [...text.matchAll(/[\u3040-\u30ff]/gu)].length;
  const devanagari = [...text.matchAll(/[\u0900-\u097f]/gu)].length;
  if (expectedCode === "ko" && hangul >= 4 && hangul / letters >= 0.15) return "script-detection";
  if (expectedCode === "ja" && kana >= 2 && kana / letters >= 0.08) return "script-detection";
  if (expectedCode === "hi" && devanagari >= 4 && devanagari / letters >= 0.15) return "script-detection";
  return null;
}

/** Match an understood provider label or a supported script-based language lens. */
export function matchesLanguageLens(reported: string, expected: string, text = ""): boolean {
  return languageLensMatchMethod(reported, expected, text) !== null;
}

/** Shared canonical identity for summary deduplication and per-run audit fingerprints. */
export function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|ref|source)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

/** Conservative copy detection: >=90% overlap of both texts, with literal quantity consistency. */
export function isNearDuplicateExcerpt(left: string, right: string): boolean {
  if (left.length < 120 || right.length < 120) return false;
  // A copied paragraph with a changed estimate is potentially counter-evidence,
  // not corroboration. Compare in both directions to retain added quantities,
  // changed currencies/scales/units, and dropped numeric qualifiers. This is
  // literal protection, not semantic equivalence or multilingual unit parsing.
  if (summaryNumericSupportFailure(left, [right]) || summaryNumericSupportFailure(right, [left])) return false;
  const shingles = (value: string) => {
    const normalized = value.normalize("NFKC").toLocaleLowerCase();
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) {
      const characters = Array.from(normalized.replace(/[^\p{L}\p{M}\p{N}]/gu, ""));
      const result = new Set<string>();
      for (let index = 0; index <= characters.length - 4; index++) result.add(characters.slice(index, index + 4).join(""));
      return result;
    }
    const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
    const result = new Set<string>();
    for (let index = 0; index <= tokens.length - 5; index++) result.add(tokens.slice(index, index + 5).join(" "));
    return result;
  };
  const leftShingles = shingles(left);
  const rightShingles = shingles(right);
  const smaller = leftShingles.size <= rightShingles.size ? leftShingles : rightShingles;
  const larger = smaller === leftShingles ? rightShingles : leftShingles;
  if (smaller.size < 8) return false;
  let shared = 0;
  for (const shingle of smaller) if (larger.has(shingle)) shared++;
  // Containment alone is not a copy: a longer reply may quote a paragraph and
  // then add a different experience. Require overlap of the larger text too.
  return shared / larger.size >= 0.9;
}

export type SummaryValidationFailure = {
  group: "response" | "baselineClaims" | "localClaims" | "comparisonClaims";
  code: "response-shape" | "claim-count" | "claim-shape" | "claim-length" | "claim-text" |
    "citation-list" | "citation-unknown" | "comparison-sides" | "quote-count" | "quote-shape" |
    "quote-reference" | "quote-not-exact" | "quote-duplicate" | "verbatim-copy" | "unsupported-number" |
    "number-not-quoted" | "quantity-unit-mismatch";
};

/** Validate the complete model output; invalid references must never be silently removed. */
export function normalizeMarketSummary(
  value: unknown,
  available: {
    us: Set<string>;
    local: Set<string>;
    evidenceText?: { us: Map<string, string>; local: Map<string, string> };
  },
  onInvalid?: (failure: SummaryValidationFailure) => void,
): MarketSummary | null {
  let reportedFailure = false;
  const fail = (code: SummaryValidationFailure["code"], group: SummaryValidationFailure["group"] = "response"): null => {
    if (!reportedFailure) onInvalid?.({ code, group });
    reportedFailure = true;
    return null;
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("response-shape");
  const record = value as Record<string, unknown>;
  const passage = (key: Exclude<SummaryValidationFailure["group"], "response">, allowed: Set<string>, requireBothGroups = false): SummaryPassage | null => {
    const reject = (code: SummaryValidationFailure["code"]) => fail(code, key);
    const rawClaims = record[key];
    if (!Array.isArray(rawClaims) || rawClaims.length < 1 || rawClaims.length > (requireBothGroups ? 1 : 3)) return reject("claim-count");
    const claims: Array<{ text: string; citations: string[]; supportingQuotes?: SummarySupportQuote[] }> = [];
    for (const rawClaim of rawClaims) {
      if (!rawClaim || typeof rawClaim !== "object" || Array.isArray(rawClaim)) return reject("claim-shape");
      const claim = rawClaim as Record<string, unknown>;
      let text = typeof claim.text === "string" ? claim.text.trim() : "";
      // Truncating here can remove a qualification or counterpoint and alter the claim.
      if (text.length > 400) return reject("claim-length");
      if (!text || /https?:\/\/|\[\s*C\d{1,4}\s*\]/i.test(text) ||
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(text) || /(?:^|\s)@[A-Za-z0-9_.-]{2,}/u.test(text) ||
        !isSingleSentence(text)) return reject("claim-text");
      if (!Array.isArray(claim.citations) || !claim.citations.length || claim.citations.length > 8 ||
        new Set(claim.citations).size !== claim.citations.length || claim.citations.some((id) => typeof id !== "string")) return reject("citation-list");
      if (claim.citations.some((id: string) => !allowed.has(id))) return reject("citation-unknown");
      const citations = claim.citations as string[];
      // Reject the whole output if a factual claim is uncited or its cited IDs
      // do not resolve to evidence actually submitted for this summary.
      if (requireBothGroups && (!citations.some((id) => available.us.has(id)) || !citations.some((id) => available.local.has(id)))) return reject("comparison-sides");
      let supportingQuotes: SummarySupportQuote[] | undefined;
      if (available.evidenceText) {
        if (!Array.isArray(claim.supportingQuotes) || claim.supportingQuotes.length !== citations.length) return reject("quote-count");
        supportingQuotes = [];
        for (const rawQuote of claim.supportingQuotes) {
          if (!rawQuote || typeof rawQuote !== "object" || Array.isArray(rawQuote)) return reject("quote-shape");
          const quoteRecord = rawQuote as Record<string, unknown>;
          const citationId = typeof quoteRecord.citationId === "string" ? quoteRecord.citationId : "";
          const quote = typeof quoteRecord.quote === "string" ? quoteRecord.quote.trim() : "";
          if (!citations.includes(citationId) || Array.from(quote).length < 8 || quote.length > 240) return reject("quote-reference");
          const sourceExcerpt = available.evidenceText.us.get(citationId) ?? available.evidenceText.local.get(citationId);
          if (!sourceExcerpt || !sourceExcerpt.includes(quote)) return reject("quote-not-exact");
          if (supportingQuotes.some((item) => item.citationId === citationId)) return reject("quote-duplicate");
          supportingQuotes.push({ citationId, quote });
        }
        if (citations.some((id) => !supportingQuotes!.some((quote) => quote.citationId === id))) return reject("quote-count");
        // Supporting excerpts are shown in a separate audit disclosure; the
        // overview must synthesize rather than simply paste a long excerpt.
        const normalizedText = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
        const normalizedClaim = normalizedText(text);
        const copiesLongQuote = supportingQuotes.some(({ quote }) => normalizedText(quote).length >= MIN_VERBATIM_COPY_REJECTION_CHARS && normalizedClaim.includes(normalizedText(quote)));
        const copiesLongExcerpt = citations.some((id) => {
          const excerpt = available.evidenceText!.us.get(id) ?? available.evidenceText!.local.get(id) ?? "";
          const normalizedExcerpt = normalizedText(excerpt);
          return normalizedExcerpt.length >= MIN_VERBATIM_COPY_REJECTION_CHARS && normalizedClaim.includes(normalizedExcerpt);
        });
        if (copiesLongQuote || copiesLongExcerpt) return reject("verbatim-copy");
      }
      // Models can ignore attribution instructions and restate a forum user's
      // precise statistic like an established market fact. Keep a deterministic
      // disclosure in the rendered sentence, and fail closed on figures that
      // do not occur in the cited excerpt(s).
      const citedEvidence = citations.flatMap((id) => {
        const inBaseline = available.us.has(id) ? available.evidenceText?.us.get(id) : undefined;
        const inLocal = available.local.has(id) ? available.evidenceText?.local.get(id) : undefined;
        return [inBaseline, inLocal].filter((excerpt): excerpt is string => typeof excerpt === "string");
      });
      const numericTokens = extractSummaryNumericTokens(text);
      if (numericTokens.length && (!citedEvidence.length || numericTokens.some((token) =>
        !citedEvidence.some((excerpt) => extractSummaryNumericTokens(excerpt).includes(token))))) return reject("unsupported-number");
      if (supportingQuotes) {
        const failure = summaryNumericSupportFailure(text, supportingQuotes.map(({ quote }) => quote));
        if (failure) return reject(failure);
      }
      // A matching number proves only that the submitted post contained it,
      // not that the number is accurate. If the model fails to attribute it,
      // wrap it deterministically as an unverified social-post claim.
      if (numericTokens.length && !isExplicitlyAttributedNumericClaim(text)) {
        text = citations.length === 1
          ? `One cited social post makes this unverified claim: ${text}`
          : `The cited social posts make this unverified claim: ${text}`;
      }
      const attributed = /^\s*(?:(?:one|a|an|the|some|these|both|each)\s+)?(?:(?:cited|retrieved|submitted|public|unverified)\s+)*(?:public\s+)?(?:post|excerpt|record|source|report|headline|discussion|sample|material)\b/iu.test(text) ||
        /^\s*(?:one cited social post makes|the cited social posts make) this unverified claim:/iu.test(text);
      text = ensureSentenceEnding(attributed ? text : `The cited, unverified material says: ${text}`);
      if (claims.some((claim) => claim.text.normalize("NFKC").toLocaleLowerCase() === text.normalize("NFKC").toLocaleLowerCase())) return reject("claim-text");
      claims.push({ text, citations, ...(supportingQuotes ? { supportingQuotes } : {}) });
    }
    const text = claims.map(({ text: value }) => value).join(" ");
    // Never truncate away a qualification, counterpoint, or its source link.
    if (text.length > 900) return reject("claim-length");
    const citations = [...new Set(claims.flatMap(({ citations: ids }) => ids))];
    if (citations.length > 8) return reject("citation-list");
    const supportingQuotes = claims.flatMap(({ supportingQuotes: quotes }) => quotes ?? []);
    return { text, citations, ...(supportingQuotes.length ? { supportingQuotes } : {}), ...(claims.length > 1 ? { claims } : {}) };
  };

  const submittedIds = new Set([...available.us, ...available.local]);
  const usSummary = available.us.size
    ? passage("baselineClaims", available.us)
    : { text: "No text-bearing records were submitted for the baseline overview. Check source status below; this does not show that discussion is absent.", citations: [] };
  const localSummary = available.local.size
    ? passage("localClaims", available.local)
    : { text: "No records passed the selected-language matching rule for this language/community overview. Check source status and the visible records below; this does not show that discussion is absent.", citations: [] };
  const comparison = available.us.size && available.local.size
    ? passage("comparisonClaims", submittedIds, true)
    : { text: "A comparison is not available because one or both sides returned no text-bearing records. The available source results are not a like-for-like sample.", citations: [...submittedIds].slice(0, 4) };
  if (!usSummary || !localSummary || !comparison) return null;

  // Model-generated limitations were uncited free text. The interface already
  // renders deterministic, code-owned coverage caveats, so ignore this field.
  return { usSummary, localSummary, comparison, limitations: [] };
}

function isExplicitlyAttributedNumericClaim(value: string): boolean {
  const text = value.normalize("NFKC");
  const identifiesSource = /\b(?:post|excerpt|account|author|source|record|comment)\b/iu.test(text);
  const attributesClaim = /\b(?:claim(?:s|ed)?|say(?:s|ing)?|report(?:s|ed)?|stat(?:e|es|ed)|assert(?:s|ed)?|allege(?:s|d)?|estimate(?:s|d)?|suggest(?:s|ed)?|indicate(?:s|d)?)\b/iu.test(text);
  return identifiesSource && attributesClaim && /\bunverif(?:ied|iable)\b/iu.test(text);
}

function isSingleSentence(value: string): boolean {
  const segments = new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(value);
  return [...segments].filter(({ segment }) => segment.trim().length > 0).length === 1;
}

function ensureSentenceEnding(value: string): string {
  const text = value.trim();
  return /[.!?…。！？]["'’”)}\]]*$/u.test(text) ? text : `${text}.`;
}
