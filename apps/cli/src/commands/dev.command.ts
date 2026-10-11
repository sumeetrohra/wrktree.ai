import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";

import { parseJson } from "@agentdeck/shared";
import { z } from "zod";

import { DaemonClient } from "#src/lib/daemon-client/index.js";
import { c, formatEvent, formatJson, print } from "#src/shared/output/index.js";

import { withClient } from "./with-client.utils.js";

const MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain",
};

const DEFAULT_TOPICS = ["global", "repo:*", "chat:*"];

async function send(rest: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...rest],
    options: { "cmd-id": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const [name, json] = positionals;
  if (name === undefined) throw new Error("usage: agentdeck dev send <command> ['<json args>']");
  const args = json === undefined ? {} : parseJson(z.unknown(), json);
  const cmdId = values["cmd-id"];
  const data = await withClient((cl) => cl.callRaw(name, args, cmdId === undefined ? {} : { cmdId }));
  print(values.json === true ? JSON.stringify(data) : formatJson(data));
}

async function watch(rest: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...rest],
    options: { from: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const topics = positionals.length > 0 ? positionals : DEFAULT_TOPICS;
  const from = Number(values.from ?? 0);
  const client = await DaemonClient.connect();
  client.onEvent((e) => {
    print(values.json === true ? JSON.stringify(e) : formatEvent(e));
  });
  await client.hello(Object.fromEntries(topics.map((t) => [t, from])), "cli-watch");
  await new Promise<void>((resolve) => {
    client.onClose(() => {
      print(c.gray("connection to the daemon closed"));
      process.exit(0);
    });
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
  client.close();
}

async function blob(rest: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...rest],
    options: { mime: { type: "string" } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (file === undefined) throw new Error("usage: agentdeck dev blob <file>");
  const mime = values.mime ?? MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const ref = await withClient((cl) => cl.upload(readFileSync(file), mime));
  print(formatJson(ref));
}

/** `agentdeck dev send | watch | blob`: low-level tools for developing against the daemon. */
export async function devCommand(args: readonly string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "send":
      return send(rest);
    case "watch":
      return watch(rest);
    case "blob":
      return blob(rest);
    default:
      throw new Error("usage: agentdeck dev send|watch|blob …");
  }
}
