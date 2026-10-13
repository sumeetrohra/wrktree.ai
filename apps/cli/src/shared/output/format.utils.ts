import type { TChatItem, TEvtFrame } from "@agentdeck/protocol";
import { z } from "zod";

const colorEnv = z
  .object({ FORCE_COLOR: z.string().optional(), NO_COLOR: z.string().optional() })
  .parse(process.env);
const useColor =
  colorEnv.FORCE_COLOR !== undefined
    ? colorEnv.FORCE_COLOR !== "0"
    : process.stdout.isTTY && !colorEnv.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  dim: paint(2),
  bold: paint(1),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  blue: paint(34),
  magenta: paint(35),
  cyan: paint(36),
  gray: paint(90),
};

/** `chat_01J9…N8` → `…P9N8`, enough to tell ids apart in a terminal. */
const short = (id: string): string => (id.length > 12 ? `…${id.slice(-4)}` : id);

const clip = (s: string, n = 70) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const statusColor = (s: string) =>
  ["ready", "idle", "done"].includes(s)
    ? c.green(s)
    : ["failed", "crashed", "setup_failed"].includes(s)
      ? c.red(s)
      : ["awaiting_permission", "limited", "archived", "stopped"].includes(s)
        ? c.yellow(s)
        : c.cyan(s);

function item(i: TChatItem): string {
  switch (i.kind) {
    case "user": {
      const first = i.attachments[0];
      const att = first ? c.gray(` [+${i.attachments.length} ${first.mime}]`) : "";
      return `${c.bold("you")}  ${clip(i.text)}${att}`;
    }
    case "agent_text":
      return `${c.magenta("agent")} ${clip(i.text)}`;
    case "thought":
      return c.gray(`thinks ${clip(i.text)}`);
    case "tool":
      return `${c.blue("tool")}  ${i.title} ${c.gray(`[${i.toolKind}]`)} ${statusColor(i.status)}`;
    case "plan":
      return `${c.blue("plan")}  ${i.entries.map((e) => `${e.status === "done" ? "☑" : e.status === "in_progress" ? "◐" : "☐"} ${e.text}`).join("  ")}`;
    case "system": {
      const col = i.level === "error" ? c.red : i.level === "warn" ? c.yellow : c.gray;
      return col(`system ${clip(i.text.split("\n")[0] ?? "", 80)}`);
    }
  }
}

/** One readable line per daemon event, as `agentdeck dev watch` prints them. */
export function formatEvent(f: TEvtFrame): string {
  const e = f.event;
  const where = c.gray(
    `${f.topic.split(":")[0]}:${short(f.topic.split(":")[1] ?? "")}#${f.cursor}`.replace(
      "global:#",
      "global#",
    ),
  );
  let body: string;
  switch (e.type) {
    case "worktree.updated":
      body = `worktree ${c.bold(e.worktree.title)} → ${statusColor(e.worktree.status)}${e.worktree.port ? c.gray(` port ${e.worktree.port}`) : ""}${e.worktree.setupError ? c.red(` ${clip(e.worktree.setupError, 50)}`) : ""}`;
      break;
    case "worktree.removed":
      body = `worktree ${short(e.worktreeId)} removed`;
      break;
    case "chat.status":
      body = `status → ${statusColor(e.status)}${e.queued ? c.yellow(` (${e.queued} queued)`) : ""}${e.resetAt ? c.gray(` resets ${new Date(e.resetAt).toISOString().slice(11, 19)}`) : ""}`;
      break;
    case "chat.item":
      body = item(e.item);
      break;
    case "chat.itemPatch": {
      const p = e.patch;
      body =
        typeof p.text === "string"
          ? c.gray(`  ↳ ${p.text.length} chars …${clip(p.text.slice(-40), 40)}`)
          : p.status
            ? c.gray(`  ↳ ${short(e.itemId)} → `) + statusColor(p.status)
            : p.entries
              ? c.gray(
                  `  ↳ plan ${p.entries.filter((x) => x.status === "done").length}/${p.entries.length} done`,
                )
              : c.gray(`  ↳ ${JSON.stringify(p)}`);
      break;
    }
    case "permission.requested":
      body = `${c.yellow("permission?")} ${e.request.title} ${c.gray(e.request.locations.join(", "))} ${c.gray(short(e.request.requestId))}`;
      break;
    case "permission.resolved":
      body = `${c.yellow("permission")} → ${e.decision === "deny" || e.decision === "cancelled" ? c.red(e.decision) : c.green(e.decision)}${e.auto ? c.gray(" (auto)") : ""}`;
      break;
    case "usage.updated":
      body = `usage ${short(e.profileId)} ${e.usage.limitHit ? c.red("limit hit") : c.green("ok")}`;
      break;
    case "proc.output":
      body = clip(e.chunk);
      break;
    case "proc.status":
      body = `${e.proc.script} ${e.proc.status === "running" ? c.green("running") : e.proc.status}${e.proc.exitCode === null ? "" : c.gray(` (exit ${String(e.proc.exitCode)})`)}`;
      break;
    case "preview.status":
      body = `preview ${e.status}`;
      break;
    case "device.updated":
      body = `device ${e.device.name} ${e.device.revokedAt === null ? c.green("paired") : c.red("revoked")}`;
      break;
    case "term.output":
      body = clip(e.data);
      break;
    case "term.status":
      body = `terminal ${short(e.terminal.id)} ${e.terminal.status === "running" ? c.green("running") : e.terminal.status}`;
      break;
    case "compare.updated":
      body = `compare ${c.bold(e.compare.title)} ${e.compare.entries.map((x) => (x.chatId ? c.green("●") : x.error ? c.red("✗") : c.gray("○"))).join("")}${e.compare.winner ? c.green(" picked") : ""}`;
      break;
  }
  return `${where} ${body}`;
}

/** Colorized, indented JSON for command results. */
export function formatJson(value: unknown): string {
  const json = JSON.stringify(value ?? null, null, 2);
  if (!useColor) return json;
  return json.replace(
    // eslint-disable-next-line security/detect-unsafe-regex -- reason: input is our own JSON.stringify output, never untrusted text
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (
      m,
      str: string | undefined,
      colon: string | undefined,
      lit: string | undefined,
      num: string | undefined,
    ) => {
      if (str) return colon ? c.cyan(str) + colon : c.green(str);
      if (lit) return c.yellow(lit);
      if (num) return c.magenta(num);
      return m;
    },
  );
}
