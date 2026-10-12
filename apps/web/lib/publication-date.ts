export type PublicationDate = { value: string; timestamp: number };

/** Numeric calendar parts only; UTC normalization must never repair invalid provider data. */
export function publicationDateFromParts(parts: unknown): PublicationDate | null {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 3 ||
    parts.some((part) => typeof part !== "number" || !Number.isInteger(part))) return null;
  const [year, month = 1, day = 1] = parts as number[];
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { value: date.toISOString().slice(0, [0, 4, 7, 10][parts.length]), timestamp };
}

export function publicationDateFromISO(value: unknown): PublicationDate | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  return publicationDateFromParts(value.split("-").map(Number));
}

/** arXiv's UTC submission timestamp; unsupported formats are not guessed. */
export function publicationTimestampUTC(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/u.test(value) ||
    !publicationDateFromISO(value.slice(0, 10))) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
