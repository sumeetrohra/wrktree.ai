import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { AgentdeckError, type TFsEntry } from "@agentdeck/protocol";
import picomatch from "picomatch";

import { searchFiles, type TSearchMatch } from "#src/infra/search/index.js";
import { DEFAULT_HIDDEN_GLOBS } from "#src/shared/files.constants.js";
import { isInside } from "#src/shared/path.utils.js";

const READ_CHUNK = 256 * 1024;
const MAX_MATCHES = 200;

export type TReadResult = { text: string; size: number; offset: number; eof: boolean };
export type TSearchResult = { matches: TSearchMatch[]; truncated: boolean };

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
 * Every path from a client or an agent goes through here (SEC2). Paths resolve with realpath and
 * must stay under the worktree root; `.git` internals and secret globs are hidden.
 */
export class FileJail {
  readonly root: string;
  private readonly hidden: (p: string) => boolean;
  private readonly hiddenGlobs: readonly string[];

  constructor(root: string, hiddenGlobs: readonly string[] = DEFAULT_HIDDEN_GLOBS) {
    this.root = realpathSync.native(root);
    this.hiddenGlobs = hiddenGlobs;
    this.hidden = picomatch([...hiddenGlobs], { dot: true, basename: true });
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
    if (isAbsolute(p) && opts.allowAbsolute !== true) {
      throw new AgentdeckError("FORBIDDEN_PATH", "Absolute paths are not allowed; use a path relative to the worktree");
    }
    const real = realpathLoose(resolve(this.root, p));
    if (!isInside(this.root, real)) throw new AgentdeckError("FORBIDDEN_PATH", `Path escapes the worktree: ${p}`);
    const rel = relative(this.root, real).split(sep).join("/");
    if (rel && this.isHidden(rel)) throw new AgentdeckError("FORBIDDEN_PATH", `Path is hidden: ${rel}`);
    return { abs: real, rel };
  }

  tree(p = ""): TFsEntry[] {
    const { abs, rel } = this.resolve(p);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new AgentdeckError("NOT_FOUND", `Not a folder: ${p}`);
    const entries: TFsEntry[] = [];
    for (const name of readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (this.isHidden(childRel)) continue;
      const st = lstatSync(join(abs, name));
      if (st.isSymbolicLink() && !this.staysInside(childRel)) continue;
      const isDir = st.isDirectory() || (st.isSymbolicLink() && statSync(join(abs, name)).isDirectory());
      entries.push(isDir ? { name, path: childRel, type: "dir" } : { name, path: childRel, type: "file", size: st.size });
    }
    return entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  }

  private staysInside(rel: string): boolean {
    try {
      this.resolve(rel);
      return true;
    } catch {
      return false;
    }
  }

  async read(p: string, offset = 0, length = READ_CHUNK): Promise<TReadResult> {
    const { abs } = this.resolve(p);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new AgentdeckError("NOT_FOUND", `Not a file: ${p}`);
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

  async search(query: string): Promise<TSearchResult> {
    const found = await searchFiles(this.root, query, this.hiddenGlobs, MAX_MATCHES);
    return { matches: found.matches.filter((m) => !this.isHidden(m.path)), truncated: found.truncated };
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
  async agentWrite(path: string, content: string): Promise<void> {
    const { abs } = this.resolve(path, { allowAbsolute: true });
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}
