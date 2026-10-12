/** Conservative plain-text/markup link detection for non-Mastodon sources. */
export function includesExternalLink(value: string | undefined) {
  return typeof value === "string" && (
    /(?:https?:\/\/|www\.)|<a\b[^>]*\bhref\s*=\s*["']https?:\/\//iu.test(value)
    || /(?:^|[^\p{L}\p{N}])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}\b(?:[/:?#][^\s<]*)?/iu.test(value)
  );
}
