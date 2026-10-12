import type { TDevice } from "@agentdeck/protocol";

import { c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

function line(d: TDevice): string {
  const state = d.connected === true ? c.green("online") : c.gray("offline");
  return `${d.id}  ${c.bold(d.name)}  ${d.kind}  ${state}${d.self === true ? c.gray("  (this computer)") : ""}`;
}

/**
 * `agentdeck devices [revoke <id>]` lists the account's phones and browsers, or removes one;
 * `agentdeck hosts` lists the account's computers.
 */
export async function devicesCommand(args: readonly string[], hosts = false): Promise<void> {
  const [sub, id] = args;
  await withClient(async (cl) => {
    if (sub === "revoke" || sub === "remove") {
      if (id === undefined) throw new Error("usage: agentdeck devices revoke <device-id>");
      const d = await cl.call("device.revoke", { deviceId: id });
      print(c.red(`Removed ${d.name} (${d.id}) from the account.`));
      return;
    }
    if (sub !== undefined) throw new Error("usage: agentdeck devices [revoke <device-id>]");
    const all = await cl.call("device.list", {});
    const devices = all.filter((d) => (d.kind === "daemon") === hosts);
    if (all.length === 0) print(c.gray("Not linked to an account. Run `agentdeck login`."));
    else if (devices.length === 0)
      print(c.gray(hosts ? "No computers." : "No phones or browsers signed in yet."));
    for (const d of devices) print(line(d));
  });
}
