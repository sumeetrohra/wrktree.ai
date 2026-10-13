import { c, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

const ACTIVE = new Set(["running", "awaiting_permission", "starting"]);

/** `agentdeck status`: the daemon, the account and relay, chats, and each profile's usage. */
export async function statusCommand(): Promise<void> {
  const s = await withClient(async (cl) => {
    const [overview, relay, account] = await Promise.all([
      cl.call("workspace.overview", {}),
      cl.call("relay.status", {}),
      cl.call("account.status", {}),
    ]);
    const usage = await Promise.all(
      overview.profiles.map(async (p) => ({ p, u: await cl.call("profile.usage", { profileId: p.id }) })),
    );
    return { overview, relay, account, usage };
  }).catch(() => null);
  if (s === null) {
    print(
      `${c.red("Daemon not running.")} Start it with ${c.bold("agentdeck daemon")} or ${c.bold("agentdeck install")}.`,
    );
    process.exitCode = 1;
    return;
  }
  const { overview, relay, account, usage } = s;
  print(`${c.bold(overview.host.name)}  ${c.green("daemon running")}`);
  const signedIn = account.state === "linked" ? `signed in as ${account.email ?? "?"}` : account.state;
  print(`Account  ${signedIn}`);
  print(
    `Relay    ${relay.url ?? "none (local only)"}${relay.url ? (relay.connected ? c.green("  connected") : c.red("  offline")) : ""}`,
  );
  const active = overview.chats.filter((ch) => ACTIVE.has(ch.status)).length;
  const limited = overview.chats.filter((ch) => ch.status === "limited").length;
  print(
    `Work     ${String(overview.repos.length)} repos · ${String(overview.worktrees.length)} worktrees · ${String(overview.chats.length)} chats (${String(active)} working${limited > 0 ? `, ${String(limited)} limited` : ""})`,
  );
  print(c.bold("\nProfiles"));
  if (usage.length === 0) print(c.gray("  none: agentdeck profile add <agent> --name <name>"));
  for (const { p, u } of usage) {
    const state = u.limitHit
      ? c.red(
          `at its limit${u.resetAt === undefined ? "" : ` until ${new Date(u.resetAt).toLocaleString()}`}`,
        )
      : c.green("available");
    const tokens =
      u.inputTokens === undefined
        ? ""
        : c.gray(`  today ${String(u.inputTokens)} in / ${String(u.outputTokens ?? 0)} out`);
    print(`  ${p.name} ${c.gray(`(${p.agent})`)}  ${state}${tokens}`);
  }
}
