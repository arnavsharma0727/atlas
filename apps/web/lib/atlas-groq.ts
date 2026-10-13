export const ATLAS_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "KR", name: "South Korea" },
  { code: "JP", name: "Japan" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "BR", name: "Brazil" },
  { code: "IN", name: "India" },
  { code: "ES", name: "Spain" },
] as const;

export type AtlasCountryCode = (typeof ATLAS_COUNTRIES)[number]["code"];
export type AtlasSource = {
  id: string;
  title: string;
  url: string;
  scope: "US" | "selected" | "other";
  excerpt: string;
  publishedAt: string | null;
};
export type AtlasClaim = { text: string; sourceIds: string[] };
export type AtlasComparison = {
  us: AtlasClaim[];
  selected: AtlasClaim[];
  differences: AtlasClaim[];
  gaps: string[];
};

export function countryName(code: string): string | null {
  return ATLAS_COUNTRIES.find((country) => country.code === code)?.name ?? null;
}

/** Browser search cannot use structured outputs, so parse its bounded final text defensively. */
export function parseGroqJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* inspect bounded objects below */ } }
  // Groq may prefix its final JSON with browser-search snippets and citation text.
  // Find balanced objects while respecting braces inside quoted strings.
  let depth = 0; let start = -1; let quoted = false; let escaped = false;
  const parsed: unknown[] = [];
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") { if (depth === 0) start = index; depth++; }
    if (char === "}" && depth > 0 && --depth === 0 && start >= 0) {
      try { parsed.push(JSON.parse(trimmed.slice(start, index + 1))); } catch { /* not JSON */ }
      start = -1;
    }
  }
  return parsed.at(-1) ?? null;
}

export function parseAtlasSources(value: unknown): AtlasSource[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { sources?: unknown }).sources)) return [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const sources: AtlasSource[] = [];
  for (const row of (value as { sources: unknown[] }).sources.slice(0, 20)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.url !== "string" || typeof item.title !== "string" || typeof item.excerpt !== "string") continue;
    let url: URL;
    try { url = new URL(item.url); } catch { continue; }
    const host = url.hostname.toLocaleLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") ||
      /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(host) ||
      /(?:^|\.)(?:bsky\.app|bsky\.social|atproto\.com)$/u.test(host) || seen.has(url.href)) continue;
    const title = item.title.trim().slice(0, 160);
    const excerpt = item.excerpt.trim().replace(/\s+/gu, " ").slice(0, 360);
    if (title.length < 5 || excerpt.length < 20 || !["US", "selected", "other"].includes(String(item.scope))) continue;
    seen.add(url.href);
    const proposedId = typeof item.id === "string" && /^S[1-9]\d?$/u.test(item.id) ? item.id : `S${sources.length + 1}`;
    if (seenIds.has(proposedId)) continue;
    seenIds.add(proposedId);
    sources.push({ id: proposedId, title, url: url.href,
      scope: item.scope as AtlasSource["scope"], excerpt,
      publishedAt: typeof item.publishedAt === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(item.publishedAt) &&
        !Number.isNaN(Date.parse(item.publishedAt)) && Date.parse(item.publishedAt) <= Date.now()
        ? item.publishedAt : null });
    if (sources.length >= 10) break;
  }
  return sources;
}

function validClaims(value: unknown, allowed: Set<string>, sources: AtlasSource[]): AtlasClaim[] | null {
  if (!Array.isArray(value)) return null;
  const claims: AtlasClaim[] = [];
  for (const row of value.slice(0, 3)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.text !== "string" || item.text.trim().length < 12 || item.text.length > 320 ||
      /https?:\/\/|〖|\[S\d+\]/u.test(item.text) || !Array.isArray(item.sourceIds) ||
      item.sourceIds.length < 1 || item.sourceIds.length > 3 ||
      item.sourceIds.some((id) => typeof id !== "string" || !allowed.has(id))) continue;
    const ids = item.sourceIds as string[];
    if (new Set(ids).size !== ids.length) continue;
    // A number in the overview must at least occur in a cited snippet. This is
    // textual consistency, not verification that the number means the same thing.
    const citedText = sources.filter((source) => ids.includes(source.id)).map((source) => source.excerpt).join(" ");
    const figures = item.text.match(/\d+(?:[.,]\d+)*(?:%|bp)?/gu) ?? [];
    if (figures.some((figure) => !citedText.includes(figure))) continue;
    claims.push({ text: item.text.trim(), sourceIds: ids });
  }
  return claims;
}

export function parseAtlasComparison(value: unknown, sources: AtlasSource[], selectedCountry: string): AtlasComparison | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const usIds = new Set(sources.filter((source) => source.scope === "US").map((source) => source.id));
  const selectedIds = new Set(sources.filter((source) => source.scope === "selected").map((source) => source.id));
  const allIds = new Set(sources.map((source) => source.id));
  const us = validClaims(row.us, usIds, sources);
  const selected = validClaims(row.selected, selectedIds, sources);
  const differences = validClaims(row.differences, allIds, sources);
  if (!us || !selected || !differences || (usIds.size && !us.length) ||
    (selectedCountry !== "US" && selectedIds.size && !selected.length) ||
    !Array.isArray(row.gaps)) return null;
  const supportedDifferences = differences.filter((claim) => selectedCountry === "US" ||
    (claim.sourceIds.some((id) => usIds.has(id)) && claim.sourceIds.some((id) => selectedIds.has(id))));
  if (row.gaps.length > 4 || row.gaps.some((gap) => typeof gap !== "string" || gap.length > 180)) return null;
  return { us, selected: selectedCountry === "US" ? [] : selected,
    differences: selectedCountry === "US" ? [] : supportedDifferences,
    gaps: (row.gaps as string[]).map((gap) => gap.trim()).filter(Boolean) };
}
