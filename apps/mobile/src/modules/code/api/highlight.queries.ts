import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { languageFor, tokenize, type TTokenLines } from "@/lib/highlight";

/** Longer files render plain: tokenizing them on a phone isn't worth the wait. */
const MAX_HIGHLIGHTED_LINES = 2000;

/** Colors a file's lines (by its path's language) off the render path; null data means plain. */
export function useHighlightQuery(
  key: string,
  path: string,
  lines: readonly string[] | undefined,
  dark: boolean,
): UseQueryResult<TTokenLines | null> {
  const lang = languageFor(path);
  return useQuery({
    queryKey: ["highlight", key, path, dark],
    queryFn: () => (lang === null || lines === undefined ? null : tokenize(lines.join("\n"), lang, dark)),
    enabled: lines !== undefined && lines.length <= MAX_HIGHLIGHTED_LINES,
    staleTime: Infinity,
  });
}
