import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { AgentdeckError, type TProfile } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import type { TRuntime } from "#src/infra/runtime/index.js";
import type { TAgentSpec, TLoginStatus } from "#src/shared/agent-spec.types.js";

import type { IAgentSpecs } from "./profiles.types.js";

type TRow = {
  id: string;
  agent: string;
  name: string;
  config_dir: string;
  color: string | null;
  created_at: number;
};

const toProfile = (r: TRow): TProfile => ({
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
export class ProfilesService {
  constructor(
    private readonly rt: TRuntime,
    private readonly agents: IAgentSpecs,
  ) {
    mkdirSync(rt.paths.shared, { recursive: true });
  }

  private row(id: string): TRow {
    const r = this.rt.db.prepare<[string], TRow>("SELECT * FROM profiles WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No profile ${id}`);
    return r;
  }

  spec(agent: string): TAgentSpec {
    return this.agents.spec(agent);
  }

  get(id: string): TProfile {
    return toProfile(this.row(id));
  }

  list(agent?: string): TProfile[] {
    const rows = agent
      ? this.rt.db
          .prepare<[string], TRow>("SELECT * FROM profiles WHERE agent = ? ORDER BY created_at")
          .all(agent)
      : this.rt.db.prepare<[], TRow>("SELECT * FROM profiles ORDER BY created_at").all();
    return rows.map(toProfile);
  }

  create(agent: string, name: string, color?: string): TProfile {
    this.spec(agent);
    if (this.rt.db.prepare("SELECT 1 FROM profiles WHERE agent = ? AND name = ?").get(agent, name)) {
      throw new AgentdeckError("CONFLICT", `A ${agent} profile named "${name}" already exists`);
    }
    const id = newId("prof");
    const dir = join(this.rt.paths.profiles, id);
    mkdirSync(dir, { recursive: true });
    this.linkShared(dir);
    const row: TRow = { id, agent, name, config_dir: dir, color: color ?? null, created_at: now() };
    this.rt.db
      .prepare(
        "INSERT INTO profiles (id, agent, name, config_dir, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.agent, row.name, row.config_dir, row.color, row.created_at);
    return toProfile(row);
  }

  remove(id: string): void {
    const r = this.row(id);
    if (this.rt.db.prepare("SELECT 1 FROM chats WHERE profile_id = ?").get(id)) {
      throw new AgentdeckError("CONFLICT", "This profile still has chats");
    }
    this.rt.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    rmSync(r.config_dir, { recursive: true, force: true });
  }

  dir(id: string): string {
    return this.row(id).config_dir;
  }

  env(id: string): Record<string, string> {
    const r = this.row(id);
    return this.spec(r.agent).profileEnv(r.config_dir);
  }

  loginStatus(id: string): TLoginStatus {
    const r = this.row(id);
    return this.spec(r.agent).loginStatus(r.config_dir);
  }

  loginCommand(id: string): { command: string[]; env: Record<string, string> } {
    const r = this.row(id);
    const spec = this.spec(r.agent);
    return { command: [...spec.loginCommand], env: spec.profileEnv(r.config_dir) };
  }

  /** Links every entry of `shared/` into a profile folder, leaving profile-specific files alone. */
  private linkShared(dir: string): void {
    for (const name of readdirSync(this.rt.paths.shared)) {
      const src = join(this.rt.paths.shared, name);
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
