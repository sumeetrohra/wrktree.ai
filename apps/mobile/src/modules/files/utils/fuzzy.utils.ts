/**
 * Fuzzy filename match: every query character appears in order. Lower scores rank higher
 * (consecutive runs and matches at the start of the name or a word count most).
 */
export function fuzzyScore(query: string, name: string): number | null {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (q === "") return 0;
  let score = 0;
  let at = -1;
  for (const ch of q) {
    const next = n.indexOf(ch, at + 1);
    if (next < 0) return null;
    const boundary = next === 0 || /[\s._/-]/.test(n[next - 1] ?? "");
    score += next - at - 1 - (boundary ? 1 : 0);
    at = next;
  }
  return score;
}

/** The items whose `name` matches, best first. */
export function fuzzyFilter<T>(query: string, items: readonly T[], name: (item: T) => string): T[] {
  return items
    .flatMap((item) => {
      const s = fuzzyScore(query, name(item));
      return s === null ? [] : [{ item, s }];
    })
    .sort((a, b) => a.s - b.s)
    .map((x) => x.item);
}
