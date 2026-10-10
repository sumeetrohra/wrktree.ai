#!/usr/bin/env node
/**
 * A scripted ACP agent. The daemon talks to it exactly as it talks to
 * claude-agent-acp or codex-acp, so the whole session stack is testable
 * without spending tokens.
 *
 * A prompt picks its behaviour with `#script:<name> key=value …`; scripts live
 * in ../scripts/<name>.json. Without a script token the agent echoes the prompt.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { CRASH_ON_START_FILE, LOGIN_FILE } from "./paths.js";

const home = process.env.FAKE_AGENT_HOME ?? join(process.cwd(), ".fake-agent");
const scriptsDir = fileURLToPath(new URL("../scripts/", import.meta.url));

type Vars = Record<string, string>;

type Step =
  | { text: string }
  | { stream: string; chunkMs?: number; words?: number }
  | { thought: string }
  | { plan: { text: string; status: "pending" | "in_progress" | "completed" }[] }
  | { tool: { id: string; title: string; kind: acp.ToolKind; locations?: string[] } }
  | { toolUpdate: { id: string; status: acp.ToolCallStatus } }
  | { permission: { toolId: string; title: string; kind: acp.ToolKind; path: string } }
  | { write: { path: string; content?: string; bytes?: number; toolId?: string } }
  | { read: { path: string } }
  | { sleep: number | string }
  | { crash: true }
  | { crashForever: true }
  | { limit: { resetInMs: number | string } }
  | { echoAttachments: true }
  | { echo: true }
  | { usage: { inputTokens: number; outputTokens: number } };

type StoredSession = { cwd: string; history: { role: "user" | "agent"; text: string }[] };

class Cancelled extends Error {}

function sessionFile(id: string): string {
  return join(home, "sessions", `${id}.json`);
}

function saveSession(id: string, s: StoredSession): void {
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(sessionFile(id), JSON.stringify(s));
}

function fill(template: string, vars: Vars): string {
  return template.replace(
    /\{\{(\w+)(?:\|([^}]*))?\}\}/g,
    (_m, key: string, fallback?: string) => vars[key] ?? fallback ?? "",
  );
}

/** Substitute `{{var|default}}` in every string of a step. */
function fillStep<T>(value: T, vars: Vars): T {
  if (typeof value === "string") return fill(value, vars) as T;
  if (Array.isArray(value)) return value.map((v) => fillStep(v, vars)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillStep(v, vars)])) as T;
  }
  return value;
}

function parsePrompt(prompt: acp.ContentBlock[]): {
  text: string;
  script: string | null;
  vars: Vars;
  images: { mimeType: string; bytes: number }[];
} {
  const text = prompt
    .filter((b): b is acp.ContentBlock & { type: "text" } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const images = prompt
    .filter((b): b is acp.ContentBlock & { type: "image" } => b.type === "image")
    .map((b) => ({ mimeType: b.mimeType, bytes: Buffer.from(b.data, "base64").length }));
  const m = /#script:([\w-]+)((?:\s+\w+=\S+)*)/.exec(text);
  const vars: Vars = { text: text.replace(/#script:\S+(\s+\w+=\S+)*/, "").trim() };
  if (m?.[2]) {
    for (const pair of m[2].trim().split(/\s+/)) {
      const [k, ...rest] = pair.split("=");
      if (k) vars[k] = rest.join("=");
    }
  }
  return { text, script: m?.[1] ?? null, vars, images };
}

class FakeAgent implements acp.Agent {
  private sessions = new Map<string, StoredSession>();
  private turns = new Map<string, AbortController>();

  constructor(private readonly conn: acp.AgentSideConnection) {}

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    if (existsSync(join(home, CRASH_ON_START_FILE))) {
      process.stderr.write("fake agent: crash-on-start marker present\n");
      process.exit(4);
    }
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      agentInfo: { name: "fake-acp-agent", version: "0.1.0" },
    };
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<void> {}

  private requireLogin(): void {
    if (!existsSync(join(home, LOGIN_FILE))) {
      throw acp.RequestError.authRequired(undefined, "fake agent: not logged in");
    }
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.requireLogin();
    const sessionId = `fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const s: StoredSession = { cwd: params.cwd, history: [] };
    this.sessions.set(sessionId, s);
    saveSession(sessionId, s);
    return { sessionId };
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    this.requireLogin();
    const file = sessionFile(params.sessionId);
    if (!existsSync(file)) throw acp.RequestError.resourceNotFound(params.sessionId);
    const s = JSON.parse(readFileSync(file, "utf8")) as StoredSession;
    s.cwd = params.cwd;
    this.sessions.set(params.sessionId, s);
    // Per ACP, a loaded session replays its conversation to the client.
    for (const h of s.history) {
      await this.conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: h.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          content: { type: "text", text: h.text },
        },
      });
    }
    return {};
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    this.turns.get(params.sessionId)?.abort();
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw acp.RequestError.resourceNotFound(params.sessionId);
    const parsed = parsePrompt(params.prompt);
    const steps: Step[] = parsed.script
      ? (JSON.parse(readFileSync(join(scriptsDir, `${parsed.script}.json`), "utf8")) as Step[])
      : [{ echo: true }];

    const abort = new AbortController();
    this.turns.set(params.sessionId, abort);
    session.history.push({ role: "user", text: parsed.text });
    const said: string[] = [];
    const ctx = { sessionId: params.sessionId, session, parsed, abort: abort.signal, said };
    try {
      for (const raw of steps) {
        if (abort.signal.aborted) throw new Cancelled();
        const outcome = await this.run(fillStep(raw, parsed.vars), ctx);
        if (outcome === "stop") break;
      }
      return { stopReason: "end_turn" };
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) return { stopReason: "cancelled" };
      throw e;
    } finally {
      this.turns.delete(params.sessionId);
      if (said.length) session.history.push({ role: "agent", text: said.join("") });
      saveSession(params.sessionId, session);
    }
  }

  private async say(
    sessionId: string,
    text: string,
    said: string[],
    kind = "agent_message_chunk",
  ): Promise<void> {
    if (kind === "agent_message_chunk") said.push(text);
    await this.conn.sessionUpdate({
      sessionId,
      update: { sessionUpdate: kind as "agent_message_chunk", content: { type: "text", text } },
    });
  }

  private async run(
    step: Step,
    ctx: {
      sessionId: string;
      session: StoredSession;
      parsed: ReturnType<typeof parsePrompt>;
      abort: AbortSignal;
      said: string[];
    },
  ): Promise<"stop" | void> {
    const { sessionId, session, said } = ctx;
    const abs = (p: string) => (isAbsolute(p) ? p : resolve(session.cwd, p));

    if ("text" in step) return this.say(sessionId, step.text, said);
    if ("echo" in step) return this.say(sessionId, `You said: ${ctx.parsed.vars.text}`, said);
    if ("thought" in step) return this.say(sessionId, step.thought, said, "agent_thought_chunk");
    if ("stream" in step) {
      const words = step.words
        ? Array.from({ length: Number(step.words) }, (_, i) => `${step.stream}${i + 1} `)
        : step.stream.split(/(?<= )/);
      for (const w of words) {
        if (ctx.abort.aborted) throw new Cancelled();
        await this.say(sessionId, w, said);
        await delay(Number(step.chunkMs ?? 5), ctx.abort);
      }
      return;
    }
    if ("plan" in step) {
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: step.plan.map((e) => ({ content: e.text, status: e.status, priority: "medium" })),
        },
      });
      return;
    }
    if ("tool" in step) {
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: step.tool.id,
          title: step.tool.title,
          kind: step.tool.kind,
          status: "pending",
          locations: (step.tool.locations ?? []).map((p) => ({ path: abs(p) })),
        },
      });
      return;
    }
    if ("toolUpdate" in step) {
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: step.toolUpdate.id,
          status: step.toolUpdate.status,
        },
      });
      return;
    }
    if ("permission" in step) {
      const p = step.permission;
      const res = await this.conn.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: p.toolId,
          title: p.title,
          kind: p.kind,
          status: "pending",
          locations: [{ path: abs(p.path) }],
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      if (res.outcome.outcome === "cancelled") throw new Cancelled();
      if (res.outcome.optionId === "reject") {
        await this.conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "tool_call_update", toolCallId: p.toolId, status: "failed" },
        });
        await this.say(sessionId, "Permission denied, so I left the file alone.", said);
        return "stop";
      }
      return;
    }
    if ("write" in step) {
      const content = step.write.content ?? makeLines(Number(step.write.bytes ?? 0));
      try {
        await this.conn.writeTextFile({ sessionId, path: abs(step.write.path), content });
        if (step.write.toolId) {
          await this.conn.sessionUpdate({
            sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: step.write.toolId, status: "completed" },
          });
        }
        await this.say(sessionId, `Wrote ${step.write.path}. `, said);
      } catch (e) {
        if (step.write.toolId) {
          await this.conn.sessionUpdate({
            sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: step.write.toolId, status: "failed" },
          });
        }
        await this.say(sessionId, `Write to ${step.write.path} was refused: ${(e as Error).message}. `, said);
      }
      return;
    }
    if ("read" in step) {
      try {
        const r = await this.conn.readTextFile({ sessionId, path: abs(step.read.path) });
        await this.say(sessionId, `${step.read.path} starts with: ${r.content.split("\n")[0]}. `, said);
      } catch (e) {
        await this.say(sessionId, `Read of ${step.read.path} was refused: ${(e as Error).message}. `, said);
      }
      return;
    }
    if ("sleep" in step) return delay(Number(step.sleep), ctx.abort);
    if ("crash" in step) {
      process.stderr.write("fake agent: scripted crash\n");
      process.exit(3);
    }
    if ("crashForever" in step) {
      writeFileSync(join(home, CRASH_ON_START_FILE), "1");
      process.exit(3);
    }
    if ("limit" in step) {
      const resetAt = Date.now() + Number(step.limit.resetInMs);
      throw new acp.RequestError(-32001, "Usage limit reached for this account", {
        kind: "usage_limit",
        resetAt,
      });
    }
    if ("echoAttachments" in step) {
      const imgs = ctx.parsed.images;
      const desc = imgs.map((i) => `${i.mimeType} (${i.bytes} bytes)`).join(", ");
      return this.say(sessionId, `Received ${imgs.length} image(s): ${desc || "none"}. `, said);
    }
    if ("usage" in step) {
      return;
    }
  }
}

/** `bytes` worth of numbered 80-column lines, so a big diff stays readable. */
function makeLines(bytes: number): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = 1; size < bytes; i++) {
    const line = `line ${String(i).padStart(6, "0")} `.padEnd(79, "-") + "\n";
    lines.push(line);
    size += line.length;
  }
  return lines.join("");
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    if (signal.aborted) return reject(new Cancelled());
    const t = setTimeout(resolveDelay, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Cancelled());
      },
      { once: true },
    );
  });
}

// A daemon that dies leaves our stdin at EOF; exit instead of lingering.
process.stdin.on("end", () => process.exit(0));
if (process.env.FAKE_AGENT_CLEAR_CRASH === "1" && existsSync(join(home, CRASH_ON_START_FILE))) {
  unlinkSync(join(home, CRASH_ON_START_FILE));
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
new acp.AgentSideConnection((conn) => new FakeAgent(conn), stream);
