/** Context that changes how a researcher should interpret a source record. */
export function hasMaterialEvidenceContext(context: string | undefined) {
  return Boolean(context && /duplicate|not independent|cross-post|marked automated|content warning|preview withheld|possible copy|near-identical|external link|linked material|title is the only|title-only|stock-promotion|clickbait/iu.test(context));
}
