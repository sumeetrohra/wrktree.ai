import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { AgentdeckError, mcpServerSchema, type TMcpServer, type TSharedConfig } from "@agentdeck/protocol";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

/** Reserved names in `shared/`; everything else there is linked into every profile as is. */
const INSTRUCTIONS = "instructions.md";
const MCP = "mcp.json";
const SKILLS = "skills";
/** A profile's own MCP servers, merged over the shared ones by name. */
export const PROFILE_MCP = "agentdeck-mcp.json";
/**
 * Files this daemon copied into a profile folder (Windows), with their size and mtime: one the
 * user has since changed is theirs. Links into `shared/` are recognised as ours by their target.
 */
const MANIFEST = ".agentdeck-shared.json";

const mcpFileSchema = z.object({ servers: z.array(mcpServerSchema) });
const manifestSchema = z.record(z.string(), z.object({ size: z.number(), mtimeMs: z.number() }));
type TManifest = z.infer<typeof manifestSchema>;

type TLink = { src: string; dst: string };

/**
 * The config every profile shares (Phase 4c), in `shared/`: `instructions.md` (linked as each
 * agent's own file: CLAUDE.md, AGENTS.md, GEMINI.md), `skills/`, and `mcp.json` (handed to the
 * agent with each session). A file the user put in a profile folder overrides the shared one; on
 * Windows files are copied (and refreshed) instead of linked.
 */
export class SharedConfig {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  get(): TSharedConfig {
    const file = join(this.dir, INSTRUCTIONS);
    const skills = join(this.dir, SKILLS);
    return {
      instructions: existsSync(file) ? readFileSync(file, "utf8") : "",
      mcpServers: this.readMcp(join(this.dir, MCP)),
      skills: existsSync(skills)
        ? readdirSync(skills, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort()
        : [],
    };
  }

  set(v: { instructions?: string | undefined; mcpServers?: TMcpServer[] | undefined }): void {
    if (v.instructions !== undefined) writeFileSync(join(this.dir, INSTRUCTIONS), v.instructions);
    if (v.mcpServers !== undefined) {
      const names = new Set(v.mcpServers.map((s) => s.name));
      if (names.size !== v.mcpServers.length) {
        throw new AgentdeckError("INVALID_ARGS", "MCP server names must be unique");
      }
      writeFileSync(join(this.dir, MCP), `${JSON.stringify({ servers: v.mcpServers }, null, 2)}\n`);
    }
  }

  private readMcp(file: string): TMcpServer[] {
    if (!existsSync(file)) return [];
    const parsed = tryParseJson(mcpFileSchema, readFileSync(file, "utf8"));
    if (!parsed) throw new AgentdeckError("BAD_STATE", `${file} is not a valid MCP server list`);
    return parsed.servers;
  }

  /** The servers a profile's sessions get: the shared ones, with the profile's own winning by name. */
  mcpServersFor(profileDir: string): TMcpServer[] {
    const merged = new Map(this.readMcp(join(this.dir, MCP)).map((s) => [s.name, s]));
    for (const s of this.readMcp(join(profileDir, PROFILE_MCP))) merged.set(s.name, s);
    return [...merged.values()];
  }

  /** What goes where in a profile folder of this agent. */
  private links(spec: TAgentSpec): TLink[] {
    const links: TLink[] = [{ src: join(this.dir, INSTRUCTIONS), dst: spec.sharedFiles.instructions }];
    if (spec.sharedFiles.skills !== undefined) {
      links.push({ src: join(this.dir, SKILLS), dst: spec.sharedFiles.skills });
    }
    for (const name of readdirSync(this.dir)) {
      if (name !== INSTRUCTIONS && name !== MCP && name !== SKILLS) {
        links.push({ src: join(this.dir, name), dst: name });
      }
    }
    return links;
  }

  private manifest(profileDir: string): TManifest {
    const file = join(profileDir, MANIFEST);
    if (!existsSync(file)) return {};
    return tryParseJson(manifestSchema, readFileSync(file, "utf8")) ?? {};
  }

  /** Ours: a link into `shared/`, or a copy we made that nobody has changed since. */
  private ours(profileDir: string, name: string, manifest: TManifest): boolean {
    const p = join(profileDir, name);
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) return resolve(profileDir, readlinkSync(p)).startsWith(resolve(this.dir));
      const copied = manifest[name];
      return copied?.size === st.size && copied.mtimeMs === st.mtimeMs;
    } catch {
      return false;
    }
  }

  /** Links (or refreshes) the shared entries into a profile folder; the user's own files stay. */
  linkInto(profileDir: string, spec: TAgentSpec): void {
    const manifest = this.manifest(profileDir);
    const next: TManifest = {};
    for (const { src, dst } of this.links(spec)) {
      const target = join(profileDir, dst);
      const present = existsSync(target) || isLink(target);
      if (present && !this.ours(profileDir, dst, manifest)) continue; // an override
      if (present) rmSync(target, { recursive: true, force: true });
      if (!existsSync(src)) continue;
      const isDir = statSync(src).isDirectory();
      if (process.platform === "win32" && !isDir) {
        copyFileSync(src, target);
        const st = statSync(target);
        next[dst] = { size: st.size, mtimeMs: st.mtimeMs };
      } else {
        symlinkSync(src, target, isDir ? "junction" : "file");
      }
    }
    writeFileSync(join(profileDir, MANIFEST), JSON.stringify(next));
  }

  /** The shared entries this profile overrides with its own files. */
  overrides(profileDir: string, spec: TAgentSpec): string[] {
    const manifest = this.manifest(profileDir);
    const names = this.links(spec)
      .map((l) => l.dst)
      .filter((dst) => {
        const p = join(profileDir, dst);
        return (existsSync(p) || isLink(p)) && !this.ours(profileDir, dst, manifest);
      });
    if (existsSync(join(profileDir, PROFILE_MCP))) names.push(PROFILE_MCP);
    return names.sort();
  }

  /** Deletes a profile's override so the shared entry applies again. */
  removeOverride(profileDir: string, spec: TAgentSpec, name: string): void {
    if (!this.overrides(profileDir, spec).includes(name)) {
      throw new AgentdeckError("NOT_FOUND", `${name} is not an override in this profile`);
    }
    rmSync(join(profileDir, name), { recursive: true, force: true });
    this.linkInto(profileDir, spec);
  }
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
