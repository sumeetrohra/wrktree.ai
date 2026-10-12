import { parseArgs } from "node:util";

import { ask, c, print, qrText } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

const POLL_MS = 500;

/**
 * `agentdeck pair [--yes]`: shows a QR code (and the same link as text), waits for the phone,
 * then asks you to compare the six-digit codes. `--yes` accepts without asking (scripts, tests).
 */
export async function pairCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { yes: { type: "boolean" } } });
  await withClient(async (cl) => {
    const { pairingId, link, expiresAt } = await cl.call("pair.start", {});
    print(await qrText(link));
    print(`Scan with the Agentdeck app, or paste this link into it:\n${c.bold(link)}`);
    print(
      c.gray(
        `Waiting for your phone (expires in ${String(Math.round((expiresAt - Date.now()) / 60000))} min)…`,
      ),
    );
    for (;;) {
      const s = await cl.call("pair.status", { pairingId });
      if (s.state === "expired") throw new Error("The pairing code expired; run `agentdeck pair` again.");
      if (s.state === "confirm") {
        const code = s.shortCode ?? "";
        print(
          `Pairing code: ${c.bold(`${code.slice(0, 3)} ${code.slice(3)}`)}  (${s.deviceName ?? "phone"})`,
        );
        const yes =
          values.yes === true || /^y(es)?$/i.test(await ask("Does your phone show the same code? [y/N] "));
        await cl.call("pair.confirm", { pairingId, accept: yes });
        print(
          yes
            ? c.green(`Paired ${s.deviceName ?? "phone"} (${s.deviceId ?? ""}).`)
            : c.red("Pairing cancelled."),
        );
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  });
}
