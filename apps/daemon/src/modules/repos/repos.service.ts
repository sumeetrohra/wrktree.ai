import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { AgentdeckError, type TRepo } from "@agentdeck/protocol";
import { newId, now, parseJson } from "@agentdeck/shared";

import { assertSafeGitArg, git } from "#src/infra/process/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { DEFAULT_HIDDEN_GLOBS } from "#src/shared/files.constants.js";
import { isInside } from "#src/shared/path.utils.js";

import { repoConfigSchema, type TRepoConfig } from "./repos.schema.js";

type TRow = { id: string; path: string; name: string; default_base: string; created_at: number };

const toRepo = (r: TRow): TRepo => ({
  id: r.id,
  path: r.path,
  name: r.name,
  defaultBase: r.default_base,
  createdAt: r.created_at,
});

export type TBrowseResult = {
  path: string | null;
  entries: { name: string; path: string; isGitRepo: boolean }[];
};

/** Repositories the user added, the browse allow-list, and each repo's `.agentdeck/config.json`. */
export class ReposService {
  private readonly roots: string[];

  constructor(private readonly rt: TRuntime) {
    this.roots = rt.opts.browseRoots.filter((r) => existsSync(r)).map((r) => realpathSync.native(r));
  }

  private inAllowList(real: string): boolean {
    return this.roots.some((r) => isInside(r, real));
  }

  list(): TRepo[] {
    return this.rt.db.prepare<[], TRow>("SELECT * FROM repos ORDER BY created_at").all().map(toRepo);
  }

  get(id: string): TRepo {
    const r = this.rt.db.prepare<[string], TRow>("SELECT * FROM repos WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No repo ${id}`);
    return toRepo(r);
  }

  /** Read from the repo's main checkout, each time it is needed, never from a worktree. */
  config(repo: TRepo): TRepoConfig {
    const file = join(repo.path, ".agentdeck", "config.json");
    if (!existsSync(file)) return repoConfigSchema.parse({});
    try {
      return parseJson(repoConfigSchema, readFileSync(file, "utf8"));
    } catch (e) {
      throw new AgentdeckError(
        "INVALID_ARGS",
        `Bad .agentdeck/config.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  hiddenGlobs(repo: TRepo): string[] {
    return [...DEFAULT_HIDDEN_GLOBS, ...this.config(repo).hiddenGlobs];
  }

  async add(path: string): Promise<TRepo> {
    if (!existsSync(path)) throw new AgentdeckError("NOT_FOUND", `No such folder: ${path}`);
    const real = realpathSync.native(path);
    if (!this.inAllowList(real)) throw new AgentdeckError("FORBIDDEN_PATH", `${path} is outside the allowed folders`);
    let top: string;
    try {
      top = realpathSync.native((await git(real, ["rev-parse", "--show-toplevel"])).trim());
    } catch {
      throw new AgentdeckError("NOT_A_REPO", `${path} is not a git repository`);
    }
    if (this.rt.db.prepare("SELECT 1 FROM repos WHERE path = ?").get(top)) {
      throw new AgentdeckError("CONFLICT", `Repo already added: ${top}`);
    }
    const branch = (await git(top, ["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim() || "main";
    const row: TRow = {
      id: newId("repo"),
      path: top,
      name: basename(top),
      default_base: assertSafeGitArg(branch, "default branch"),
      created_at: now(),
    };
    const repo = toRepo(row);
    const config = this.config(repo);
    this.rt.db
      .prepare(
        "INSERT INTO repos (id, path, name, default_base, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.path, row.name, row.default_base, JSON.stringify(config), row.created_at);
    return repo;
  }

  remove(repoId: string): void {
    this.get(repoId);
    if (this.rt.db.prepare("SELECT 1 FROM worktrees WHERE repo_id = ?").get(repoId)) {
      throw new AgentdeckError("CONFLICT", "Delete this repo's worktrees first");
    }
    this.rt.db.prepare("DELETE FROM repos WHERE id = ?").run(repoId);
  }

  /** Folders only, inside the allow-list, for picking a repo to add. */
  browse(path?: string): TBrowseResult {
    if (path === undefined) {
      return {
        path: null,
        entries: this.roots.map((r) => ({ name: basename(r) || r, path: r, isGitRepo: existsSync(join(r, ".git")) })),
      };
    }
    if (!existsSync(path)) throw new AgentdeckError("NOT_FOUND", `No such folder: ${path}`);
    const real = realpathSync.native(path);
    if (!this.inAllowList(real)) throw new AgentdeckError("FORBIDDEN_PATH", `${path} is outside the allowed folders`);
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
