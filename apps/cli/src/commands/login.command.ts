import { parseArgs } from "node:util";

import { c, print, qrText } from "#src/shared/output/index.js";

import { openInBrowser } from "./open-browser.utils.js";
import { withClient } from "./with-client.utils.js";

const POLL_MS = 1000;

/**
 * `agentdeck login [--print]`: links this computer to your account, like `gh auth login`. Shows a
 * code to approve in the Agentdeck app (signed in), or opens the approval page in the browser.
 * `--print` prints the code and link and returns at once; the daemon keeps waiting for approval.
 */
export async function loginCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { print: { type: "boolean" } } });
  await withClient(async (cl) => {
    const status = await cl.call("account.status", {});
    if (status.state === "local") {
      throw new Error("No relay is configured: run `agentdeck relay set <url>` first.");
    }
    if (status.state === "linked") {
      print(c.green(`Already linked${status.email === null ? "" : ` as ${status.email}`}.`));
      return;
    }
    const { code, url, expiresAt } = await cl.call("account.link", {});
    if (values.print === true) {
      print(`${code} ${url}`);
      return;
    }
    print(await qrText(url));
    print(`Your code: ${c.bold(code)}`);
    print(`Approve it in the Agentdeck app (Hosts → Link a computer), or at:\n${c.bold(url)}`);
    if (await openInBrowser(url)) print(c.gray("Opened the approval page in your browser."));
    const minutes = String(Math.round((expiresAt - Date.now()) / 60000));
    print(c.gray(`Waiting for approval (expires in ${minutes} min)…`));
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const s = await cl.call("account.status", {});
      if (s.state === "linked") {
        print(
          c.green(
            `Linked${s.email === null ? "" : ` as ${s.email}`}. Your devices can see this computer now.`,
          ),
        );
        return;
      }
      if (s.state !== "linking") throw new Error("The code expired; run `agentdeck login` again.");
    }
  });
}

/** `agentdeck logout`: this computer leaves the account and forgets its device token. */
export async function logoutCommand(): Promise<void> {
  await withClient(async (cl) => {
    await cl.call("account.logout", {});
    print(c.green("Logged out. Your devices no longer see this computer."));
  });
}
