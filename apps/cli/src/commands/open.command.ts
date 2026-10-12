import { parseArgs } from "node:util";

import { runQuiet } from "#src/lib/process/index.js";
import { c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

function openerFor(url: string): string[] {
  switch (process.platform) {
    case "darwin":
      return ["open", url];
    case "win32":
      return ["cmd", "/c", "start", "", url];
    default:
      return ["xdg-open", url];
  }
}

/** `agentdeck open [--print]`: opens the desktop web UI (a one-time link, valid for 60 s). */
export async function openCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { print: { type: "boolean" } } });
  const { url } = await withClient((cl) => cl.call("web.open", {}));
  if (url === null) {
    throw new Error(
      "No web UI configured: start the daemon with AGENTDECK_WEB_ROOT=<path to apps/mobile/dist>",
    );
  }
  if (values.print === true) {
    print(url);
    return;
  }
  const r = await runQuiet(openerFor(url));
  print(
    r.code === 0 ? c.green("Opened the web UI in your browser.") : `Open this link within a minute:\n${url}`,
  );
}
