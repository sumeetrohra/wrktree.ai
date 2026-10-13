import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { AgentdeckError, type TRepo, type TWorktree, type TWorktreeStatus } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import { assertSafeGitArg, childEnv, git, killTree, spawnShell } from "#src/infra/process/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";

import { longPathArgs, worktreePath } from "./worktree-path.utils.js";
import type { IRepoSource, IWorktreeHooks } from "./worktrees.types.js";

type TRow = {
  id: string;
  repo_id: string;
  title: string;
  branch: string;
  base_ref: string;
  path: string;
  status: TWorktreeStatus;
  port: number | null;
  setup_error: string | null;
  created_at: number;
  archived_at: number | null;
};

const toWorktree = (r: TRow): TWorktree => ({
  id: r.id,
  repoId: r.repo_id,
  title: r.title,
  branch: r.branch,
  baseRef: r.base_ref,
  path: r.path,
  status: r.status,
  port: r.port,
  setupError: r.setup_error,
  createdAt: r.created_at,
  archivedAt: r.archived_at,
});

const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL = 4000;

export class WorktreesService {
  hooks: IWorktreeHooks = {
    stopChats: () => undefined,
    startChats: () => undefined,
    deleteChats: () => undefined,
  };
  /** Background setup work, so tests and shutdown can wait for it. */
  private pending = new Set<Promise<void>>();

  constructor(
    private readonly rt: TRuntime,
    private readonly repos: IRepoSource,
  ) {
    // A daemon that died mid-setup leaves rows that will never finish on their own.
    rt.db
      .prepare(
        "UPDATE worktrees SET status = 'setup_failed', setup_error = 'Interrupted by a daemon restart' WHERE status IN ('creating', 'setting_up')",
      )
      .run();
  }

  private row(id: string): TRow {
    const r = this.rt.db.prepare<[string], TRow>("SELECT * FROM worktrees WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No worktree ${id}`);
    return r;
  }

  get(id: string): TWorktree {
    return toWorktree(this.row(id));
  }

  list(repoId: string): TWorktree[] {
    this.repos.get(repoId);
    return this.rt.db
      .prepare<[string], TRow>("SELECT * FROM worktrees WHERE repo_id = ? ORDER BY created_at")
      .all(repoId)
      .map(toWorktree);
  }

  all(): TWorktree[] {
    return this.rt.db.prepare<[], TRow>("SELECT * FROM worktrees ORDER BY created_at").all().map(toWorktree);
  }

  private update(id: string, fields: Partial<TRow>): TWorktree {
    const keys = Object.keys(fields);
    this.rt.db
      .prepare(`UPDATE worktrees SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`)
      .run({ ...fields, id });
    const wt = this.get(id);
    this.rt.bus.publish(`repo:${wt.repoId}`, { type: "worktree.updated", worktree: wt });
    return wt;
  }

  /** Lowest free port in the configured range; archived worktrees hold none. */
  private allocatePort(): number {
    const used = new Set(
      this.rt.db
        .prepare<[], { port: number }>("SELECT port FROM worktrees WHERE port IS NOT NULL")
        .all()
        .map((r) => r.port),
    );
    const [lo, hi] = this.rt.opts.portRange;
    for (let p = lo; p <= hi; p++) if (!used.has(p)) return p;
    throw new AgentdeckError("PORTS_EXHAUSTED", `No free port in ${lo}-${hi}`, true);
  }

  /** Default location: `<repo>/../.agentdeck-worktrees/<repo-name>/<branch>`. */
  private pathFor(repo: TRepo, branch: string): string {
    return worktreePath(repo, branch, this.rt.opts.worktreeRoot);
  }

  async create(args: {
    repoId: string;
    baseRef?: string | undefined;
    branch: string;
    title: string;
  }): Promise<TWorktree> {
    const repo = this.repos.get(args.repoId);
    const baseRef = assertSafeGitArg(args.baseRef ?? repo.defaultBase, "base ref");
    assertSafeGitArg(args.branch, "branch name");
    const check = await git(repo.path, ["check-ref-format", "--branch", args.branch], [1, 128]);
    if (!check.trim()) throw new AgentdeckError("INVALID_ARGS", `Invalid branch name: ${args.branch}`);
    if (!(await git(repo.path, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], [1])).trim()) {
      throw new AgentdeckError("NOT_FOUND", `Unknown base ref: ${baseRef}`);
    }
    if (await git(repo.path, ["branch", "--list", args.branch])) {
      throw new AgentdeckError("CONFLICT", `Branch ${args.branch} already exists`);
    }
    const path = this.pathFor(repo, args.branch);
    if (existsSync(path)) throw new AgentdeckError("CONFLICT", `Folder already exists: ${path}`);

    const id = newId("wt");
    this.rt.db.transaction(() => {
      this.rt.db
        .prepare(
          `INSERT INTO worktrees (id, repo_id, title, branch, base_ref, path, status, port, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?)`,
        )
        .run(id, repo.id, args.title, args.branch, baseRef, path, this.allocatePort(), now());
    })();
    const wt = this.get(id);
    this.rt.bus.publish(`repo:${repo.id}`, { type: "worktree.updated", worktree: wt });
    this.track(this.provision(id, repo, ["worktree", "add", "-b", args.branch, path, baseRef]));
    return wt;
  }

  private track(p: Promise<void>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** `git worktree add` (when needed), then the repo's setup scripts. */
  private async provision(id: string, repo: TRepo, addArgs: readonly string[] | null): Promise<void> {
    try {
      if (addArgs) {
        mkdirSync(dirname(this.row(id).path), { recursive: true });
        await git(repo.path, [...longPathArgs(process.platform), ...addArgs]);
      }
      const wt = this.update(id, { status: "setting_up" });
      const config = this.repos.config(repo);
      const result = await this.runScripts(config.setup, wt, repo, config.env);
      if (result.ok) this.update(id, { status: "ready", setup_error: null });
      else this.update(id, { status: "setup_failed", setup_error: result.output });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.rt.log.warn({ worktreeId: id, code: "PROVISION_FAILED" }, "worktree provisioning failed");
      this.update(id, { status: "setup_failed", setup_error: message });
    }
  }

  private async runScripts(
    scripts: readonly string[],
    wt: TWorktree,
    repo: TRepo,
    extraEnv: Readonly<Record<string, string>>,
  ): Promise<{ ok: boolean; output: string }> {
    let output = "";
    const env = childEnv({
      ...extraEnv,
      AGENTDECK_WORKTREE: wt.path,
      AGENTDECK_PORT: String(wt.port ?? ""),
      AGENTDECK_REPO_ROOT: repo.path,
    });
    for (const script of scripts) {
      const code = await new Promise<number>((resolve) => {
        const child = spawnShell(script, { cwd: wt.path, env });
        const onData = (d: Buffer) => {
          output = (output + d.toString()).slice(-OUTPUT_TAIL);
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        const timer = setTimeout(() => {
          output += `\n[agentdeck] "${script}" timed out after ${SCRIPT_TIMEOUT_MS / 1000}s`;
          killTree(child);
        }, SCRIPT_TIMEOUT_MS);
        child.on("error", (e) => {
          output += `\n${e.message}`;
        });
        child.on("close", (c) => {
          clearTimeout(timer);
          resolve(c ?? 1);
        });
      });
      if (code !== 0) return { ok: false, output: `$ ${script}\n${output}`.trim() };
    }
    return { ok: true, output };
  }

  async archive(id: string): Promise<TWorktree> {
    const r = this.row(id);
    if (r.status === "archived") return toWorktree(r);
    if (r.status === "creating" || r.status === "setting_up") {
      throw new AgentdeckError("BAD_STATE", "Wait for setup to finish before archiving", true);
    }
    this.hooks.stopChats(id);
    const repo = this.repos.get(r.repo_id);
    if (existsSync(r.path)) await this.runScripts(this.repos.config(repo).teardown, toWorktree(r), repo, {});
    // The folder and branch stay, so restoring is instant and nothing uncommitted is lost.
    return this.update(id, { status: "archived", port: null, archived_at: now() });
  }

  async restore(id: string): Promise<TWorktree> {
    const r = this.row(id);
    if (r.status !== "archived")
      throw new AgentdeckError("BAD_STATE", "Only archived worktrees can be restored");
    const repo = this.repos.get(r.repo_id);
    this.rt.db.transaction(() => {
      this.rt.db
        .prepare("UPDATE worktrees SET status = 'setting_up', port = ?, archived_at = NULL WHERE id = ?")
        .run(this.allocatePort(), id);
    })();
    const addArgs = existsSync(r.path) ? null : ["worktree", "add", r.path, r.branch];
    await this.provision(id, repo, addArgs);
    const wt = this.get(id);
    if (wt.status === "ready") this.hooks.startChats(id);
    return wt;
  }

  async delete(id: string): Promise<void> {
    const r = this.row(id);
    if (r.status === "creating" || r.status === "setting_up") {
      throw new AgentdeckError("BAD_STATE", "Wait for setup to finish before deleting", true);
    }
    const repo = this.repos.get(r.repo_id);
    this.hooks.stopChats(id);
    if (r.status !== "archived" && existsSync(r.path)) {
      await this.runScripts(this.repos.config(repo).teardown, toWorktree(r), repo, {});
    }
    await git(repo.path, ["worktree", "remove", "--force", r.path], [128]);
    await git(repo.path, ["worktree", "prune"]);
    await git(repo.path, ["branch", "-D", r.branch], [1]);
    this.rt.db.transaction(() => {
      this.hooks.deleteChats(id);
      this.rt.db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
    })();
    this.rt.bus.publish(`repo:${r.repo_id}`, { type: "worktree.removed", worktreeId: id });
  }
}
