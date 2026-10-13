/**
 * The fixed request `pr.draft` sends to a chat's agent, and how its reply becomes a PR title and
 * body. Shared so the scripted test agent can recognise the request.
 */
export const PR_DRAFT_REQUEST =
  "Write a pull request title and description for the changes in this worktree. " +
  "Reply with `Title: <title>` on the first line, a blank line, then the description in Markdown. " +
  "Don't change any files.";

/**
 * Reads `Title: …` and the body after it; without a `Title:` line, the first non-empty line is the
 * title. Code fences around the whole reply are dropped.
 */
export function parsePrDraft(reply: string): { title: string; body: string } {
  const text = reply
    .trim()
    .replace(/^```[\w-]*\n([\s\S]*)\n```$/, "$1")
    .trim();
  const lines = text.split("\n");
  const unbold = (l: string): string => l.replace(/\*\*/g, "").trim();
  const at = lines.findIndex((l) => /^title\s*:/i.test(unbold(l)));
  const start = at >= 0 ? at : lines.findIndex((l) => l.trim() !== "");
  if (start < 0) return { title: "", body: "" };
  const title = unbold(lines[start] ?? "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^#+\s*/, "");
  const rest = lines
    .slice(start + 1)
    .join("\n")
    .trim();
  const body = rest.replace(/^\**\s*(description|body)\s*:\s*\**\s*/i, "").trim();
  return { title, body };
}
