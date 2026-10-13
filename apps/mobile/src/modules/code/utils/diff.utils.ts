/** One row of a unified diff, ready to render: line numbers on each side, or a hunk header. */
export type TDiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "add"; text: string; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "ctx"; text: string; oldNo: number; newNo: number };

/** `@@ -12,7 +12,9 @@ …`: where the hunk starts on each side. */
function hunkStart(line: string): { old: number; new: number } | null {
  if (!line.startsWith("@@ -")) return null;
  const old = /^@@ -(\d+)/.exec(line)?.[1];
  const neu = / \+(\d+)/.exec(line)?.[1];
  return old === undefined || neu === undefined ? null : { old: Number(old), new: Number(neu) };
}

/**
 * Parses `git diff` output for one file into rows. File headers (`diff --git`, `---`, `+++`,
 * `index`, mode lines) are dropped; "\ No newline at end of file" is skipped.
 */
export function parseUnifiedDiff(diff: string): TDiffRow[] {
  const rows: TDiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = hunkStart(line);
    if (hunk) {
      oldNo = hunk.old;
      newNo = hunk.new;
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    else if (line.startsWith(" "))
      rows.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    else if (line.startsWith("diff --git")) inHunk = false;
  }
  return rows;
}

/** The line a diff row points at in the current file (deleted lines have none). */
export function newLineOf(row: TDiffRow): number | null {
  return row.kind === "add" || row.kind === "ctx" ? row.newNo : null;
}
