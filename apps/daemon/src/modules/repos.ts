import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { z } from "zod";
import { AgentdeckError, type Repo } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";
import type { Ctx } from "../context.js";
import { git } from "../util/exec.js";
import { DEFAULT_HIDDEN_GLOBS } from "./files.js";

/** `.agentdeck/config.json` in a repo. */
export const RepoConfig = z.object({
  setup: z.array(z.string()).default([]),
  teardown: z.array(z.string()).default([]),
  hiddenGlobs: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});
export type RepoConfig = z.infer<typeof RepoConfig>;

type Row = { id: string; path: string; name: string; default_base: string; created_at: number };

const toRepo = (r: Row): Repo => ({
  id: r.id,
  path: r.path,
  name: r.name,
  defaultBase: r.default_base,
  createdAt: r.created_at,
});

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p);

export class Repos {
  private roots: string[];

  constructor(private readonly ctx: Ctx) {
    this.roots = ctx.opts.browseRoots.filter((r) => existsSync(r)).map((r) => realpathSync.native(r));
  }

  private inAllowList(real: string): boolean {
    return this.roots.some((r) => norm(real) === norm(r) || norm(real).startsWith(norm(r) + sep));
  }

  list(): Repo[] {
    return this.ctx.db.prepare<[], Row>("SELECT * FROM repos ORDER BY created_at").all().map(toRepo);
  }

  get(id: string): Repo {
    const r = this.ctx.db.prepare<[string], Row>("SELECT * FROM repos WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No repo ${id}`);
    return toRepo(r);
  }

  /** Reads `.agentdeck/config.json` from the repo's main checkout, each time it is needed. */
  config(repo: Repo): RepoConfig {
    const file = join(repo.path, ".agentdeck", "config.json");
    if (!existsSync(file)) return RepoConfig.parse({});
    try {
      return RepoConfig.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch (e) {
      throw new AgentdeckError("INVALID_ARGS", `Bad .agentdeck/config.json: ${(e as Error).message}`);
    }
  }

  hiddenGlobs(repo: Repo): string[] {
    return [...DEFAULT_HIDDEN_GLOBS, ...this.config(repo).hiddenGlobs];
  }

  async add(path: string): Promise<Repo> {
    if (!existsSync(path)) throw new AgentdeckError("NOT_FOUND", `No such folder: ${path}`);
    const real = realpathSync.native(path);
    if (!this.inAllowList(real))
      throw new AgentdeckError("FORBIDDEN_PATH", `${path} is outside the allowed folders`);
    let top: string;
    try {
      top = realpathSync.native((await git(real, ["rev-parse", "--show-toplevel"])).trim());
    } catch {
      throw new AgentdeckError("NOT_A_REPO", `${path} is not a git repository`);
    }
    if (this.ctx.db.prepare("SELECT 1 FROM repos WHERE path = ?").get(top)) {
      throw new AgentdeckError("CONFLICT", `Repo already added: ${top}`);
    }
    const branch = (await git(top, ["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim() || "main";
    const row: Row = {
      id: newId("repo"),
      path: top,
      name: basename(top),
      default_base: branch,
      created_at: now(),
    };
    const repo = toRepo(row);
    const config = this.config(repo);
    this.ctx.db
      .prepare(
        "INSERT INTO repos (id, path, name, default_base, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.path, row.name, row.default_base, JSON.stringify(config), row.created_at);
    return repo;
  }

  remove(repoId: string): void {
    this.get(repoId);
    if (this.ctx.db.prepare("SELECT 1 FROM worktrees WHERE repo_id = ?").get(repoId)) {
      throw new AgentdeckError("CONFLICT", "Delete this repo's worktrees first");
    }
    this.ctx.db.prepare("DELETE FROM repos WHERE id = ?").run(repoId);
  }

  /** Folders only, inside the allow-list, for picking a repo to add. */
  browse(path?: string) {
    if (!path) {
      return {
        path: null,
        entries: this.roots.map((r) => ({
          name: basename(r) || r,
          path: r,
          isGitRepo: existsSync(join(r, ".git")),
        })),
      };
    }
    if (!existsSync(path)) throw new AgentdeckError("NOT_FOUND", `No such folder: ${path}`);
    const real = realpathSync.native(path);
    if (!this.inAllowList(real))
      throw new AgentdeckError("FORBIDDEN_PATH", `${path} is outside the allowed folders`);
    const entries = readdirSync(real)
      .filter((name) => !name.startsWith("."))
      .map((name) => join(real, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .map((p) => ({ name: basename(p), path: p, isGitRepo: existsSync(join(p, ".git")) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { path: real, entries };
  }
}
