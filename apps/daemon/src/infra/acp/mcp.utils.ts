import type { McpServer } from "@agentclientprotocol/sdk";
import type { TMcpServer } from "@agentdeck/protocol";

const pairs = (r: Readonly<Record<string, string>>): { name: string; value: string }[] =>
  Object.entries(r).map(([name, value]) => ({ name, value }));

/** The shared config's MCP servers (Phase 4c) as ACP `session/new` and `session/load` take them. */
export function acpMcpServers(servers: readonly TMcpServer[]): McpServer[] {
  return servers.map((s) =>
    s.type === "stdio"
      ? { name: s.name, command: s.command, args: [...s.args], env: pairs(s.env) }
      : { type: s.type, name: s.name, url: s.url, headers: pairs(s.headers) },
  );
}
