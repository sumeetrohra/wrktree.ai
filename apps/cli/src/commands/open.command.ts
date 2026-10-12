import { parseArgs } from "node:util";

import { c, print } from "#src/shared/output/index.js";

import { openInBrowser } from "./open-browser.utils.js";
import { withClient } from "./with-client.utils.js";

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
  print(
    (await openInBrowser(url))
      ? c.green("Opened the web UI in your browser.")
      : `Open this link within a minute:\n${url}`,
  );
}
