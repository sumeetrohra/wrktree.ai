import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, open, writeFile, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import picomatch from "picomatch";
import { AgentdeckError, type FsEntry } from "@agentdeck/protocol";
import { run } from "../util/exec.js";

export const DEFAULT_HIDDEN_GLOBS = [".env*", "*.pem", "*.key"];
const READ_CHUNK = 256 * 1024;
const MAX_MATCHES = 200;

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p);

function rgPath(): string {
  try {
    const require = createRequire(import.meta.url);
    const p = (require("@vscode/ripgrep") as { rgPath: string }).rgPath;
    if (existsSync(p)) return p;
  } catch {
    // fall through to PATH
  }
  return "rg";
}

/** realpath of `p`, or of its nearest existing ancestor plus the rest, for paths about to be created. */
function realpathLoose(p: string): string {
  let cur = p;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync.native(cur), ...rest);
}

/**
 * Every path from a client or an agent goes through here. Paths resolve with
 * realpath and must stay under the worktree root; `.git` internals and secret
 * globs are hidden.
 */
export class FileJail {
  readonly root: string;
  private hidden: (p: string) => boolean;

  constructor(root: string, hiddenGlobs: string[] = DEFAULT_HIDDEN_GLOBS) {
    this.root = realpathSync.native(root);
    this.hidden = picomatch(hiddenGlobs, { dot: true, basename: true });
  }

  /** True for `.git/…` and anything matching the hidden globs. `rel` uses `/` or the OS separator. */
  isHidden(rel: string): boolean {
    const parts = rel.split(/[\\/]/).filter(Boolean);
    return parts.includes(".git") || parts.some((part) => this.hidden(part));
  }

  /**
   * Resolves a client path (relative to the root) or, with `allowAbsolute`, an agent
   * path (absolute, inside the root). Returns the real absolute path and its relative form.
   */
  resolve(p: string, opts: { allowAbsolute?: boolean } = {}): { abs: string; rel: string } {
    if (isAbsolute(p) && !opts.allowAbsolute) {
      throw new AgentdeckError(
        "FORBIDDEN_PATH",
        "Absolute paths are not allowed; use a path relative to the worktree",
      );
    }
    const real = realpathLoose(resolve(this.root, p));
    const inside = norm(real) === norm(this.root) || norm(real).startsWith(norm(this.root) + sep);
    if (!inside) throw new AgentdeckError("FORBIDDEN_PATH", `Path escapes the worktree: ${p}`);
    const rel = relative(this.root, real).split(sep).join("/");
    if (rel && this.isHidden(rel)) throw new AgentdeckError("FORBIDDEN_PATH", `Path is hidden: ${rel}`);
    return { abs: real, rel };
  }

  tree(p = ""): FsEntry[] {
    const { abs, rel } = this.resolve(p);
    if (!existsSync(abs) || !statSync(abs).isDirectory())
      throw new AgentdeckError("NOT_FOUND", `Not a folder: ${p}`);
    const entries: FsEntry[] = [];
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (this.isHidden(childRel)) continue;
      const st = lstatSync(join(abs, name));
      if (st.isSymbolicLink()) {
        // Only list links that stay inside the jail.
        try {
          this.resolve(childRel);
        } catch {
          continue;
        }
      }
      const isDir = st.isDirectory() || (st.isSymbolicLink() && statSync(join(abs, name)).isDirectory());
      entries.push(
        isDir ? { name, path: childRel, type: "dir" } : { name, path: childRel, type: "file", size: st.size },
      );
    }
    return entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
  }

  async read(p: string, offset = 0, length = READ_CHUNK) {
    const { abs } = this.resolve(p);
    if (!existsSync(abs) || !statSync(abs).isFile())
      throw new AgentdeckError("NOT_FOUND", `Not a file: ${p}`);
    const size = statSync(abs).size;
    const len = Math.min(length, READ_CHUNK, Math.max(0, size - offset));
    const fh = await open(abs, "r");
    try {
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      return { text: buf.toString("utf8"), size, offset, eof: offset + len >= size };
    } finally {
      await fh.close();
    }
  }

  async search(query: string, hiddenGlobs: string[]) {
    const args = [
      "--json",
      "--hidden",
      "--smart-case",
      "--fixed-strings",
      "--max-count",
      "20",
      "-g",
      "!.git",
    ];
    for (const g of hiddenGlobs) args.push("-g", `!${g}`);
    args.push("--", query, ".");
    const r = await run(rgPath(), args, { cwd: this.root });
    if (r.code > 1) throw new AgentdeckError("INTERNAL", `ripgrep failed: ${r.stderr.trim()}`);
    const matches: { path: string; line: number; text: string }[] = [];
    let truncated = false;
    for (const line of r.stdout.split("\n")) {
      if (!line) continue;
      const m = JSON.parse(line) as {
        type: string;
        data: { path: { text: string }; line_number: number; lines: { text?: string } };
      };
      if (m.type !== "match") continue;
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      const path = m.data.path.text
        .replace(/^\.[\\/]/, "")
        .split(sep)
        .join("/");
      if (this.isHidden(path)) continue;
      matches.push({ path, line: m.data.line_number, text: (m.data.lines.text ?? "").replace(/\r?\n$/, "") });
    }
    return { matches, truncated };
  }

  /** ACP `fs/read_text_file`: absolute path from the agent, optional 1-based line window. */
  async agentRead(path: string, line?: number | null, limit?: number | null): Promise<string> {
    const { abs } = this.resolve(path, { allowAbsolute: true });
    const text = await readFile(abs, "utf8");
    if (!line && !limit) return text;
    const lines = text.split("\n");
    const start = Math.max(0, (line ?? 1) - 1);
    return lines.slice(start, limit ? start + limit : undefined).join("\n");
  }

  /** ACP `fs/write_text_file`. */
  async agentWrite(path: string, content: string): Promise<string> {
    const { abs, rel } = this.resolve(path, { allowAbsolute: true });
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
    return rel;
  }
}
