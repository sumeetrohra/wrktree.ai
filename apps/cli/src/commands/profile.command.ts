import { parseArgs } from "node:util";

import { runInteractive } from "#src/lib/process/index.js";
import { c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

/** `agentdeck profile add <agent> --name <name>`: creates the profile, then runs its login. */
export async function profileCommand(args: readonly string[]): Promise<void> {
  const [sub, ...rest] = args;
  const { values, positionals } = parseArgs({
    args: rest,
    options: { name: { type: "string" } },
    allowPositionals: true,
  });
  const agent = positionals[0];
  const name = values.name;
  if (sub !== "add" || agent === undefined || name === undefined) {
    throw new Error("usage: agentdeck profile add <agent> --name <name>");
  }
  const { profile, login } = await withClient(async (cl) => {
    const created = await cl.call("profile.create", { agent, name });
    return { profile: created, login: await cl.call("profile.loginCommand", { profileId: created.id }) };
  });
  print(`Created profile ${c.bold(profile.name)} ${c.gray(profile.id)}; logging in…`);
  const code = await runInteractive(login.command, login.env);
  if (code !== 0) throw new Error(`Login command exited with ${String(code)}`);
}
