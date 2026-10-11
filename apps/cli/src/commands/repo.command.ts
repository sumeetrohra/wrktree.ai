import { resolve } from "node:path";

import { formatJson, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

/** `agentdeck repo add <path>` */
export async function repoCommand(args: readonly string[]): Promise<void> {
  const [sub, path] = args;
  if (sub !== "add") throw new Error("usage: agentdeck repo add <path>");
  const repo = await withClient((cl) => cl.call("repo.add", { path: resolve(path ?? ".") }));
  print(formatJson(repo));
}
