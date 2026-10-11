import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";

import { AgentdeckError } from "@agentdeck/protocol";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { run } from "../process/index.js";

export type TSearchMatch = { path: string; line: number; text: string };

const rgModuleSchema = z.object({ rgPath: z.string() });
const rgLineSchema = z.object({
  type: z.string(),
  data: z
    .object({
      path: z.object({ text: z.string() }).optional(),
      line_number: z.number().optional(),
      lines: z.object({ text: z.string().optional() }).optional(),
    })
    .optional(),
});

function rgPath(): string {
  try {
    const require = createRequire(import.meta.url);
    const mod = rgModuleSchema.safeParse(require("@vscode/ripgrep"));
    if (mod.success && existsSync(mod.data.rgPath)) return mod.data.rgPath;
  } catch {
    // fall through to PATH
  }
  return "rg";
}

/**
 * Fixed-string, smart-case search under `cwd` with ripgrep. `.git` and `excludeGlobs` are never
 * searched; the query goes after `--` so it can't be read as a flag.
 */
export async function searchFiles(
  cwd: string,
  query: string,
  excludeGlobs: readonly string[],
  limit: number,
): Promise<{ matches: TSearchMatch[]; truncated: boolean }> {
  const args = ["--json", "--hidden", "--smart-case", "--fixed-strings", "--max-count", "20", "-g", "!.git"];
  for (const g of excludeGlobs) args.push("-g", `!${g}`);
  args.push("--", query, ".");
  const r = await run(rgPath(), args, { cwd });
  if (r.code > 1) throw new AgentdeckError("INTERNAL", `ripgrep failed: ${r.stderr.trim()}`);
  const matches: TSearchMatch[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    const parsed = tryParseJson(rgLineSchema, line);
    if (parsed?.type !== "match" || !parsed.data) continue;
    if (matches.length >= limit) return { matches, truncated: true };
    const d = parsed.data;
    matches.push({
      path: (d.path?.text ?? "").replace(/^\.[\\/]/, "").split(sep).join("/"),
      line: d.line_number ?? 0,
      text: (d.lines?.text ?? "").replace(/\r?\n$/, ""),
    });
  }
  return { matches, truncated: false };
}
