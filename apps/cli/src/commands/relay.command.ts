import { z } from "zod";

import { updateConfigFile } from "#src/shared/config-file/index.js";
import { c, formatJson, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

/** `agentdeck relay set <url>` saves the relay; `agentdeck relay status` asks the daemon. */
export async function relayCommand(args: readonly string[]): Promise<void> {
  const [sub, url] = args;
  if (sub === "set") {
    const parsed = z.url({ protocol: /^https?$/ }).safeParse(url);
    if (!parsed.success) throw new Error("usage: agentdeck relay set <https://relay-url>");
    updateConfigFile({ relayUrl: parsed.data });
    print(`Relay set to ${c.bold(parsed.data)}. Restart the daemon to connect.`);
    return;
  }
  if (sub === "status") {
    print(formatJson(await withClient((cl) => cl.call("relay.status", {}))));
    return;
  }
  throw new Error("usage: agentdeck relay set <url> | agentdeck relay status");
}
