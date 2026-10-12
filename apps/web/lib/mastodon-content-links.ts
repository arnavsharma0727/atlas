import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { includesExternalLink } from "./external-links";

type Node = DefaultTreeAdapterMap["node"];
const normalizeTag = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

/** Ignore only verified hashtag navigation, never arbitrary links wearing a hashtag class. */
export function mastodonHasContentLink(html: string, tags: unknown, originHost: string, timelineHost: string): boolean {
  if (html.length > 65_536) return true;
  const allowedHosts = new Set([originHost, timelineHost]);
  const tagNameForUrl = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !allowedHosts.has(url.hostname)) return null;
      const match = url.pathname.match(/^\/tags\/([^/]+)\/?$/u);
      return match ? normalizeTag(decodeURIComponent(match[1])) : null;
    } catch { return null; }
  };
  const knownTags = new Set<string>();
  if (Array.isArray(tags) && tags.length <= 100) for (const tag of tags) {
    if (!tag || typeof tag !== "object" || typeof tag.name !== "string" || typeof tag.url !== "string") continue;
    const name = normalizeTag(tag.name);
    if (name && tagNameForUrl(tag.url) === name) knownTags.add(name);
  }
  const root = parseFragment(html);
  const stack: Node[] = [...root.childNodes].reverse();
  const text: string[] = [];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++visited > 5_000) return true;
    if ("value" in node && node.nodeName === "#text") text.push(node.value);
    if ("tagName" in node && node.tagName === "a") {
      const attrs = new Map(node.attrs.map(({ name, value }) => [name, value]));
      const tag = tagNameForUrl(attrs.get("href") ?? "");
      const classes = (attrs.get("class") ?? "").split(/\s+/u);
      const rels = (attrs.get("rel") ?? "").split(/\s+/u);
      // The visible label must itself be exactly #tag (possibly nested spans).
      const labelNodes: Node[] = [...node.childNodes].reverse();
      let label = "";
      let labelVisited = 0;
      while (labelNodes.length) {
        if (++labelVisited > 500) return true;
        const child = labelNodes.pop()!;
        if ("value" in child && child.nodeName === "#text") label += child.value;
        if ("childNodes" in child) labelNodes.push(...[...child.childNodes].reverse());
      }
      if (!tag || !knownTags.has(tag) || !classes.includes("hashtag") || !rels.includes("tag") ||
        normalizeTag(label.trim()) !== `#${tag}`) return true;
    }
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) continue;
    if ("childNodes" in node) stack.push(...[...node.childNodes].reverse());
  }
  // Parse5 decodes HTML entities, so concealed/plain-text URLs still count.
  return includesExternalLink(text.join(""));
}
