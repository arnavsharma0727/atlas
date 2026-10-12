const EUROPE = new Set(["DE", "FR", "ES"]);
const RATE_TERMS = /\b(?:interest rates?|rate cuts?|rate hikes?|monetary policy|central bank|inflation|cpi|discount rate|fed|fomc|selic)\b|juros|inflaç|zinssatz|inflation|taux d.intérêt|inflaci[oó]n|금리|금융 정책|金利|インフレ/iu;
export const LABOR_TERMS = /\b(?:unemployment|jobless|labor market|labour market|jobs report|employment|hiring|layoffs?|wages?)\b|실업|雇用|失業|desemprego|chômage|arbeitslos|desempleo/iu;
const PRICE_TERMS = /\b(?:inflation|cpi|consumer prices?|cost of living)\b|물가|インフレ|消費者物価|inflaç|inflaci[oó]n|teuerung/iu;
const INDUSTRY_TERMS = /\b(?:industr(?:y|ial)|manufactur(?:ing|e|ers?)|factor(?:y|ies)|semiconductors?|microchips?|automotive|vehicles?|electric cars?|steel|chemicals?|batter(?:y|ies)|machinery|solar panels?)\b|produktion|industrie|fabrication|industriel|autom[oó]vil|veh[ií]culos|producci[oó]n|반도체|제조|産業|製造/iu;

export function officialDriverPlan(topic: string, country: string): string[] {
  return [
    ...(EUROPE.has(country) && INDUSTRY_TERMS.test(topic) ? ["eurostat-industrial"] : []),
    ...(LABOR_TERMS.test(topic) || PRICE_TERMS.test(topic) ? ["bls-us"] : []),
    ...(RATE_TERMS.test(topic) ? ["fed-policy"] : []),
    ...(country === "BR" ? ["bcb-selic"] : []),
  ];
}
