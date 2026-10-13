import { readFileSync } from "node:fs";

import type { TMcpServer, TSharedConfig } from "@agentdeck/protocol";

import { c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

const USAGE = `usage:
  agentdeck config shared                                   show the shared instructions, MCP servers and skills
  agentdeck config shared instructions <file>               use this file as every agent's instructions
  agentdeck config shared mcp add <name> -- <command> [args…]
  agentdeck config shared mcp add <name> --url <url> [--sse]
  agentdeck config shared mcp remove <name>
  agentdeck config overrides <profileId> [remove <file>]    a profile's own files that win over the shared ones`;

function show(cfg: TSharedConfig): void {
  const lines = cfg.instructions.split("\n");
  print(c.bold("Instructions") + c.gray(" (shared/instructions.md)"));
  print(
    cfg.instructions
      ? lines.slice(0, 5).join("\n") + (lines.length > 5 ? c.gray("\n…") : "")
      : c.gray("  none"),
  );
  print(c.bold("\nMCP servers") + c.gray(" (shared/mcp.json)"));
  if (cfg.mcpServers.length === 0) print(c.gray("  none"));
  for (const s of cfg.mcpServers) {
    print(
      `  ${s.name}  ${c.gray(s.type === "stdio" ? [s.command, ...s.args].join(" ") : `${s.type} ${s.url}`)}`,
    );
  }
  print(c.bold("\nSkills") + c.gray(" (shared/skills/)"));
  print(cfg.skills.length > 0 ? cfg.skills.map((s) => `  ${s}`).join("\n") : c.gray("  none"));
}

/** `<name> -- <command> [args…]` or `<name> --url <url> [--sse]`. */
function parseMcp(args: readonly string[]): TMcpServer {
  const [name, flag, ...rest] = args;
  if (name === undefined || flag === undefined) throw new Error(USAGE);
  if (flag === "--") {
    const [command, ...cmdArgs] = rest;
    if (command === undefined) throw new Error(USAGE);
    return { type: "stdio", name, command, args: cmdArgs, env: {} };
  }
  if (flag === "--url" && rest[0] !== undefined) {
    return { type: rest.includes("--sse") ? "sse" : "http", name, url: rest[0], headers: {} };
  }
  throw new Error(USAGE);
}

/** `agentdeck config …` (Phase 4c): the config every profile on this computer shares. */
export async function configCommand(args: readonly string[]): Promise<void> {
  const [area, sub, ...rest] = args;
  if (area === "overrides" && sub !== undefined) {
    const [action, file] = rest;
    if (action === "remove" && file !== undefined) {
      await withClient((cl) => cl.call("profile.removeOverride", { profileId: sub, name: file }));
      print(`Removed ${c.bold(file)}; the shared one applies again.`);
      return;
    }
    const { files } = await withClient((cl) => cl.call("profile.overrides", { profileId: sub }));
    print(files.length > 0 ? files.join("\n") : c.gray("No overrides: this profile uses the shared config."));
    return;
  }
  if (area !== "shared") throw new Error(USAGE);
  if (sub === undefined) {
    show(await withClient((cl) => cl.call("config.shared.get", {})));
    return;
  }
  if (sub === "instructions" && rest[0] !== undefined) {
    const instructions = readFileSync(rest[0], "utf8");
    await withClient((cl) => cl.call("config.shared.set", { instructions }));
    print(`Shared instructions set from ${rest[0]}.`);
    return;
  }
  if (sub === "mcp") {
    const [action, ...more] = rest;
    const saved = await withClient(async (cl) => {
      const { mcpServers } = await cl.call("config.shared.get", {});
      if (action === "add") {
        const server = parseMcp(more);
        const next = [...mcpServers.filter((s) => s.name !== server.name), server];
        return cl.call("config.shared.set", { mcpServers: next });
      }
      if (action === "remove" && more[0] !== undefined) {
        return cl.call("config.shared.set", { mcpServers: mcpServers.filter((s) => s.name !== more[0]) });
      }
      throw new Error(USAGE);
    });
    show(saved);
    return;
  }
  throw new Error(USAGE);
}
