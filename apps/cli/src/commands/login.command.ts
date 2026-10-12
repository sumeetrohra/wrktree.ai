import { parseArgs } from "node:util";

import type { TAccountStatus } from "@agentdeck/protocol";

import { ask, c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

function signedIn(s: TAccountStatus): void {
  if (s.state !== "linked") throw new Error("Sign-in didn't finish; run `agentdeck login` again.");
  print(
    c.green(`Signed in${s.email === null ? "" : ` as ${s.email}`}. Your devices can see this computer now.`),
  );
}

/**
 * `agentdeck login [--email <you@…>] [--link <url>] [--dev <uid>]`: signs this computer in to your
 * account, like the app does. Firebase emails a sign-in link; paste it here (or pass `--link`).
 * `--dev <uid>` signs in on a dev relay without email (tests, local work).
 */
export async function loginCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { email: { type: "string" }, link: { type: "string" }, dev: { type: "string" } },
  });
  await withClient(async (cl) => {
    const status = await cl.call("account.status", {});
    if (status.state === "local") {
      throw new Error("No relay is configured: run `agentdeck relay set <url>` first.");
    }
    if (status.state === "linked") {
      print(c.green(`Already signed in${status.email === null ? "" : ` as ${status.email}`}.`));
      return;
    }
    if (values.dev !== undefined) {
      signedIn(await cl.call("account.signInDev", { uid: values.dev }));
      return;
    }
    if (status.state !== "awaitingLink" || values.email !== undefined) {
      const email = values.email ?? (await ask("Email: "));
      await cl.call("account.signIn", { email });
      print(`We emailed a sign-in link to ${c.bold(email)}.`);
    }
    const link = values.link ?? (await ask("Paste the link from the email: "));
    signedIn(await cl.call("account.completeSignIn", { link }));
  });
}

/** `agentdeck logout`: this computer leaves the account and forgets its tokens. */
export async function logoutCommand(): Promise<void> {
  await withClient(async (cl) => {
    await cl.call("account.logout", {});
    print(c.green("Logged out. Your devices no longer see this computer."));
  });
}
