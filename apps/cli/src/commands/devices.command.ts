import { c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

/** `agentdeck devices` lists paired devices; `agentdeck devices revoke <id>` revokes one. */
export async function devicesCommand(args: readonly string[]): Promise<void> {
  const [sub, id] = args;
  await withClient(async (cl) => {
    if (sub === "revoke") {
      if (id === undefined) throw new Error("usage: agentdeck devices revoke <device-id>");
      const d = await cl.call("device.revoke", { deviceId: id });
      print(c.red(`Revoked ${d.name} (${d.id}).`));
      return;
    }
    if (sub !== undefined) throw new Error("usage: agentdeck devices [revoke <device-id>]");
    const devices = await cl.call("device.list", {});
    if (devices.length === 0) print(c.gray("No paired devices. Run `agentdeck pair`."));
    for (const d of devices) {
      const state = d.revokedAt === null ? c.green("active") : c.red("revoked");
      print(`${d.id}  ${c.bold(d.name)}  ${d.kind}  ${state}`);
    }
  });
}
