import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { defaultHome, pathsFor } from "@agentdeck/daemon";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { c, formatJson, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

const configSchema = z.looseObject({ relayUrl: z.url().optional() });

/** `agentdeck relay set <url>` saves the relay; `agentdeck relay status` asks the daemon. */
export async function relayCommand(args: readonly string[]): Promise<void> {
  const [sub, url] = args;
  if (sub === "set") {
    const parsed = z.url({ protocol: /^https?$/ }).safeParse(url);
    if (!parsed.success) throw new Error("usage: agentdeck relay set <https://relay-url>");
    const file = pathsFor(defaultHome()).config;
    const current = existsSync(file) ? (tryParseJson(configSchema, readFileSync(file, "utf8")) ?? {}) : {};
    writeFileSync(file, JSON.stringify({ ...current, relayUrl: parsed.data }, null, 2), { mode: 0o600 });
    print(`Relay set to ${c.bold(parsed.data)}. Restart the daemon to connect.`);
    return;
  }
  if (sub === "status") {
    print(formatJson(await withClient((cl) => cl.call("relay.status", {}))));
    return;
  }
  throw new Error("usage: agentdeck relay set <url> | agentdeck relay status");
}
