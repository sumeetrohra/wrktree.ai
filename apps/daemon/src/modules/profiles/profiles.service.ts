import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { AgentdeckError, type TMcpServer, type TProfile, type TSharedConfig } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import type { TRuntime } from "#src/infra/runtime/index.js";
import type { TAgentSpec, TLoginStatus } from "#src/shared/agent-spec.types.js";

import type { IAgentSpecs } from "./profiles.types.js";
import { SharedConfig } from "./shared-config.service.js";

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
  private readonly shared: SharedConfig;

  constructor(
    private readonly rt: TRuntime,
    private readonly agents: IAgentSpecs,
  ) {
    this.shared = new SharedConfig(rt.paths.shared);
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
    this.shared.linkInto(dir, this.spec(agent));
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

  /** The config every profile shares (Phase 4c). */
  sharedConfig(): TSharedConfig {
    return this.shared.get();
  }

  /** Saves the shared config and re-links it into every profile. */
  setSharedConfig(v: {
    instructions?: string | undefined;
    mcpServers?: TMcpServer[] | undefined;
  }): TSharedConfig {
    this.shared.set(v);
    this.syncShared();
    return this.shared.get();
  }

  /** Re-links the shared config into every profile folder (daemon start, and after a change). */
  syncShared(): void {
    for (const r of this.rt.db.prepare<[], TRow>("SELECT * FROM profiles").all()) {
      try {
        mkdirSync(r.config_dir, { recursive: true });
        this.shared.linkInto(r.config_dir, this.spec(r.agent));
      } catch (e) {
        this.rt.log.warn(
          { profileId: r.id, err: e instanceof Error ? e.message : String(e) },
          "shared config not linked",
        );
      }
    }
  }

  /** The MCP servers this profile's sessions get. */
  mcpServers(id: string): TMcpServer[] {
    return this.shared.mcpServersFor(this.row(id).config_dir);
  }

  overrides(id: string): string[] {
    const r = this.row(id);
    return this.shared.overrides(r.config_dir, this.spec(r.agent));
  }

  removeOverride(id: string, name: string): void {
    const r = this.row(id);
    this.shared.removeOverride(r.config_dir, this.spec(r.agent), name);
  }
}
