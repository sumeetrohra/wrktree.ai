#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runDaemon } from "@agentdeck/daemon";
import { CommandError, DaemonClient } from "./client.js";
import { c, formatEvent, formatJson } from "./format.js";

const HELP = `agentdeck — drive coding agents on this machine

  agentdeck daemon                              run the daemon in the foreground
  agentdeck repo add <path>                     add a git repository
  agentdeck profile add <agent> --name <name>   create a profile and log it in
  agentdeck dev send <command> ['<json args>']  send one command, print the reply
        [--cmd-id <cmd_…>] [--json]
  agentdeck dev watch [topic …] [--from <n>]    print events (default: global repo:* chat:*)
  agentdeck dev blob <file> [--mime <type>]     upload a file, print its BlobRef

The daemon's folder comes from AGENTDECK_HOME (or the OS default).`;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain",
};

async function withClient<T>(fn: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = await DaemonClient.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

function fail(e: unknown): never {
  if (e instanceof CommandError) {
    process.stdout.write(`${c.red(`error ${e.error.code}`)}: ${e.error.message}\n`);
  } else {
    process.stderr.write(`${c.red("error")}: ${(e as Error).message ?? String(e)}\n`);
  }
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, sub, ...rest] = argv;

  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (cmd === "daemon") return runDaemon();

  if (cmd === "repo" && sub === "add") {
    const path = resolve(rest[0] ?? ".");
    const repo = await withClient((cl) => cl.call("repo.add", { path }));
    process.stdout.write(formatJson(repo) + "\n");
    return;
  }

  if (cmd === "profile" && sub === "add") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { name: { type: "string" } },
      allowPositionals: true,
    });
    const agent = positionals[0];
    if (!agent || !values.name) throw new Error("usage: agentdeck profile add <agent> --name <name>");
    const { profile, login } = await withClient(async (cl) => {
      const profile = await cl.call("profile.create", { agent, name: values.name! });
      return { profile, login: await cl.call("profile.loginCommand", { profileId: profile.id }) };
    });
    process.stdout.write(`Created profile ${c.bold(profile.name)} ${c.gray(profile.id)}; logging in…\n`);
    const [file, ...args] = login.command;
    const code = await new Promise<number>((res) => {
      const child = spawn(file!, args, { stdio: "inherit", env: { ...process.env, ...login.env } });
      child.on("close", (c2) => res(c2 ?? 1));
      child.on("error", () => res(127));
    });
    if (code !== 0) throw new Error(`Login command exited with ${code}`);
    return;
  }

  if (cmd === "dev" && sub === "send") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { "cmd-id": { type: "string" }, json: { type: "boolean" } },
      allowPositionals: true,
    });
    const [name, json] = positionals;
    if (!name) throw new Error("usage: agentdeck dev send <command> ['<json args>']");
    const args: unknown = json ? JSON.parse(json) : {};
    const data = await withClient((cl) =>
      cl.callRaw(name, args, values["cmd-id"] ? { cmdId: values["cmd-id"] } : {}),
    );
    process.stdout.write((values.json ? JSON.stringify(data) : formatJson(data)) + "\n");
    return;
  }

  if (cmd === "dev" && sub === "watch") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { from: { type: "string" }, json: { type: "boolean" } },
      allowPositionals: true,
    });
    const topics = positionals.length ? positionals : ["global", "repo:*", "chat:*"];
    const from = Number(values.from ?? 0);
    const client = await DaemonClient.connect();
    client.onEvent((e) => process.stdout.write((values.json ? JSON.stringify(e) : formatEvent(e)) + "\n"));
    await client.hello(Object.fromEntries(topics.map((t) => [t, from])), "cli-watch");
    await new Promise<void>((res) => {
      client.onClose(() => {
        process.stdout.write(c.gray("connection to the daemon closed") + "\n");
        process.exit(0);
      });
      process.on("SIGINT", () => res());
      process.on("SIGTERM", () => res());
    });
    client.close();
    return;
  }

  if (cmd === "dev" && sub === "blob") {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { mime: { type: "string" } },
      allowPositionals: true,
    });
    const file = positionals[0];
    if (!file) throw new Error("usage: agentdeck dev blob <file>");
    const mime = values.mime ?? MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const ref = await withClient((cl) => cl.upload(readFileSync(file), mime));
    process.stdout.write(formatJson(ref) + "\n");
    return;
  }

  throw new Error(`Unknown command: ${argv.join(" ")}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch(fail);
