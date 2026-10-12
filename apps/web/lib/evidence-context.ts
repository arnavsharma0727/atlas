/** Context that changes how a researcher should interpret a source record. */
export function hasMaterialEvidenceContext(context: string | undefined) {
  return Boolean(context && /duplicate|not independent|cross-post|marked automated|content warning|preview withheld|possible copy|near-identical|external link|linked material|title is the only|title-only|stock-promotion|clickbait|attributes its material to a publisher|matched the selected .* language lens by script|excerpt (?:is )?(?:shortened|modified)|html formatting removed/iu.test(context));
}
