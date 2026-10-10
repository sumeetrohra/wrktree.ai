import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { AgentdeckError, type Profile } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";
import type { Ctx } from "../context.js";
import type { AgentRegistry, AgentSpec } from "./sessions/agents.js";

type Row = {
  id: string;
  agent: string;
  name: string;
  config_dir: string;
  color: string | null;
  created_at: number;
};

const toProfile = (r: Row): Profile => ({
  id: r.id,
  agent: r.agent,
  name: r.name,
  color: r.color,
  createdAt: r.created_at,
});

/**
 * A profile is one agent account: an isolated config folder (CLAUDE_CONFIG_DIR,
 * CODEX_HOME, …) with the shared MCP config, skills and instructions linked in.
 */
export class Profiles {
  constructor(
    private readonly ctx: Ctx,
    private readonly agents: AgentRegistry,
  ) {
    mkdirSync(ctx.paths.shared, { recursive: true });
  }

  private row(id: string): Row {
    const r = this.ctx.db.prepare<[string], Row>("SELECT * FROM profiles WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No profile ${id}`);
    return r;
  }

  spec(agent: string): AgentSpec {
    const s = this.agents.get(agent);
    if (!s)
      throw new AgentdeckError(
        "UNKNOWN_AGENT",
        `Unknown agent: ${agent}. Known: ${this.agents.ids().join(", ")}`,
      );
    return s;
  }

  get(id: string): Profile {
    return toProfile(this.row(id));
  }

  list(agent?: string): Profile[] {
    const rows = agent
      ? this.ctx.db
          .prepare<[string], Row>("SELECT * FROM profiles WHERE agent = ? ORDER BY created_at")
          .all(agent)
      : this.ctx.db.prepare<[], Row>("SELECT * FROM profiles ORDER BY created_at").all();
    return rows.map(toProfile);
  }

  create(agent: string, name: string, color?: string): Profile {
    this.spec(agent);
    if (this.ctx.db.prepare("SELECT 1 FROM profiles WHERE agent = ? AND name = ?").get(agent, name)) {
      throw new AgentdeckError("CONFLICT", `A ${agent} profile named "${name}" already exists`);
    }
    const id = newId("prof");
    const dir = join(this.ctx.paths.profiles, id);
    mkdirSync(dir, { recursive: true });
    this.linkShared(dir);
    const row: Row = { id, agent, name, config_dir: dir, color: color ?? null, created_at: now() };
    this.ctx.db
      .prepare(
        "INSERT INTO profiles (id, agent, name, config_dir, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.agent, row.name, row.config_dir, row.color, row.created_at);
    return toProfile(row);
  }

  remove(id: string): void {
    const r = this.row(id);
    if (this.ctx.db.prepare("SELECT 1 FROM chats WHERE profile_id = ?").get(id)) {
      throw new AgentdeckError("CONFLICT", "This profile still has chats");
    }
    this.ctx.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    rmSync(r.config_dir, { recursive: true, force: true });
  }

  dir(id: string): string {
    return this.row(id).config_dir;
  }

  env(id: string): Record<string, string> {
    const r = this.row(id);
    return this.spec(r.agent).profileEnv(r.config_dir);
  }

  loginStatus(id: string) {
    const r = this.row(id);
    return this.spec(r.agent).loginStatus(r.config_dir);
  }

  loginCommand(id: string) {
    const r = this.row(id);
    const spec = this.spec(r.agent);
    return { command: spec.loginCommand, env: spec.profileEnv(r.config_dir) };
  }

  /** Links every entry of `shared/` into a profile folder, leaving profile-specific files alone. */
  private linkShared(dir: string): void {
    for (const name of readdirSync(this.ctx.paths.shared)) {
      const src = join(this.ctx.paths.shared, name);
      const dst = join(dir, name);
      if (existsSync(dst)) continue;
      const isDir = statSync(src).isDirectory();
      if (process.platform === "win32") {
        if (isDir) symlinkSync(src, dst, "junction");
        else copyFileSync(src, dst);
      } else {
        symlinkSync(src, dst);
      }
    }
  }
}
