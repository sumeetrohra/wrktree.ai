/** Selected lines of a file, 1-based and inclusive. */
export type TLineRange = { line: number; endLine: number };

export const inRange = (r: TLineRange | null, line: number): boolean =>
  r !== null && line >= r.line && line <= r.endLine;

/** Long-press: grow the selection to include `line` (or start one there). */
export function extendRange(r: TLineRange | null, line: number): TLineRange {
  if (r === null) return { line, endLine: line };
  return { line: Math.min(r.line, line), endLine: Math.max(r.endLine, line) };
}
