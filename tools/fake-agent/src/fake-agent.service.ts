import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

import { CRASH_ON_START_FILE, INSTRUCTIONS_FILE, LOGIN_FILE } from "./paths.constants.js";
import { parsePrompt, type TParsedPrompt } from "./prompt.utils.js";
import { loadScript, type TStep } from "./script.schema.js";
import { loadSession, saveSession, type TStoredSession } from "./session-store.utils.js";

const SCRIPTS_DIR = fileURLToPath(new URL("../scripts/", import.meta.url));

class Cancelled extends Error {}

type TTurn = {
  sessionId: string;
  session: TStoredSession;
  prompt: TParsedPrompt;
  abort: AbortSignal;
  said: string[];
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
  return new Promise((done, fail) => {
    if (signal.aborted) {
      fail(new Cancelled());
      return;
    }
    const t = setTimeout(done, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        fail(new Cancelled());
      },
      { once: true },
    );
  });
}

/**
 * A scripted ACP agent. The daemon talks to it exactly as it talks to claude-agent-acp or
 * codex-acp, so the whole session stack is testable without spending tokens.
 * A prompt picks its behaviour with `#script:<name> key=value …`; without one it echoes.
 */
export class FakeAgent implements acp.Agent {
  private readonly sessions = new Map<string, TStoredSession>();
  private readonly turns = new Map<string, AbortController>();

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- reason: SDK 1.8 deprecates this for the builder API; the fake mirrors what real adapters still use
    private readonly conn: acp.AgentSideConnection,
    private readonly home: string,
  ) {}

  initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    if (existsSync(join(this.home, CRASH_ON_START_FILE))) {
      process.stderr.write("fake agent: crash-on-start marker present\n");
      process.exit(4);
    }
    return Promise.resolve({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      agentInfo: { name: "fake-acp-agent", version: "0.1.0" },
    });
  }

  authenticate(_params: acp.AuthenticateRequest): Promise<void> {
    return Promise.resolve();
  }

  private requireLogin(): void {
    if (!existsSync(join(this.home, LOGIN_FILE))) {
      throw acp.RequestError.authRequired(undefined, "fake agent: not logged in");
    }
  }

  newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.requireLogin();
    const sessionId = `fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const s: TStoredSession = { cwd: params.cwd, history: [], mcp: params.mcpServers.map((m) => m.name) };
    this.sessions.set(sessionId, s);
    saveSession(this.home, sessionId, s);
    return Promise.resolve({ sessionId });
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    this.requireLogin();
    const stored = loadSession(this.home, params.sessionId);
    if (!stored) throw acp.RequestError.resourceNotFound(params.sessionId);
    const s = { ...stored, cwd: params.cwd, mcp: params.mcpServers.map((m) => m.name) };
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

  cancel(params: acp.CancelNotification): Promise<void> {
    this.turns.get(params.sessionId)?.abort();
    return Promise.resolve();
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw acp.RequestError.resourceNotFound(params.sessionId);
    const prompt = parsePrompt(params.prompt);
    const steps: TStep[] =
      prompt.script === null ? [{ echo: true }] : loadScript(SCRIPTS_DIR, prompt.script, prompt.vars);

    const abort = new AbortController();
    this.turns.set(params.sessionId, abort);
    session.history.push({ role: "user", text: prompt.text });
    const turn: TTurn = { sessionId: params.sessionId, session, prompt, abort: abort.signal, said: [] };
    try {
      for (const step of steps) {
        if (abort.signal.aborted) throw new Cancelled();
        if ((await this.run(step, turn)) === "stop") break;
      }
      return { stopReason: "end_turn", usage: usageOf(session.history, turn.said) };
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) return { stopReason: "cancelled" };
      throw e;
    } finally {
      this.turns.delete(params.sessionId);
      if (turn.said.length > 0) session.history.push({ role: "agent", text: turn.said.join("") });
      saveSession(this.home, params.sessionId, session);
    }
  }

  private async say(
    turn: TTurn,
    text: string,
    kind: "agent_message_chunk" | "agent_thought_chunk" = "agent_message_chunk",
  ): Promise<void> {
    if (kind === "agent_message_chunk") turn.said.push(text);
    await this.conn.sessionUpdate({
      sessionId: turn.sessionId,
      update: { sessionUpdate: kind, content: { type: "text", text } },
    });
  }

  private async toolStatus(turn: TTurn, toolCallId: string, status: acp.ToolCallStatus): Promise<void> {
    await this.conn.sessionUpdate({
      sessionId: turn.sessionId,
      update: { sessionUpdate: "tool_call_update", toolCallId, status },
    });
  }

  private async run(step: TStep, turn: TTurn): Promise<"stop" | "next"> {
    const abs = (p: string): string => (isAbsolute(p) ? p : resolve(turn.session.cwd, p));
    const { sessionId } = turn;

    if ("text" in step) await this.say(turn, step.text);
    else if ("echo" in step) await this.say(turn, `You said: ${turn.prompt.vars["text"] ?? ""}`);
    else if ("thought" in step) await this.say(turn, step.thought, "agent_thought_chunk");
    else if ("stream" in step) {
      const words =
        step.words === undefined
          ? step.stream.split(/(?<= )/)
          : Array.from({ length: step.words }, (_, i) => `${step.stream}${String(i + 1)} `);
      for (const w of words) {
        if (turn.abort.aborted) throw new Cancelled();
        await this.say(turn, w);
        await delay(step.chunkMs ?? 5, turn.abort);
      }
    } else if ("plan" in step) {
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: step.plan.map((e) => ({ content: e.text, status: e.status, priority: "medium" })),
        },
      });
    } else if ("tool" in step) {
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
    } else if ("toolUpdate" in step) {
      await this.toolStatus(turn, step.toolUpdate.id, step.toolUpdate.status);
    } else if ("permission" in step) {
      return this.permission(step.permission, turn, abs);
    } else if ("write" in step) {
      await this.write(step.write, turn, abs);
    } else if ("read" in step) {
      try {
        const r = await this.conn.readTextFile({ sessionId, path: abs(step.read.path) });
        await this.say(turn, `${step.read.path} starts with: ${r.content.split("\n")[0] ?? ""}. `);
      } catch (e) {
        await this.say(turn, `Read of ${step.read.path} was refused: ${errorMessage(e)}. `);
      }
    } else if ("sleep" in step) {
      await delay(step.sleep, turn.abort);
    } else if ("crash" in step) {
      process.stderr.write("fake agent: scripted crash\n");
      process.exit(3);
    } else if ("crashForever" in step) {
      writeFileSync(join(this.home, CRASH_ON_START_FILE), "1");
      process.exit(3);
    } else if ("limit" in step) {
      const resetAt = Date.now() + step.limit.resetInMs;
      throw new acp.RequestError(-32001, "Usage limit reached for this account", {
        kind: "usage_limit",
        resetAt,
      });
    } else if ("mcpReport" in step) {
      const names = turn.session.mcp;
      await this.say(turn, `MCP servers: ${names.length > 0 ? names.join(", ") : "none"}. `);
    } else if ("instructionsReport" in step) {
      // Like a real agent reading its instructions file from its config folder.
      const file = join(this.home, INSTRUCTIONS_FILE);
      const first = existsSync(file) ? (readFileSync(file, "utf8").split("\n")[0] ?? "") : "";
      await this.say(turn, first ? `Instructions: ${first}. ` : "No instructions. ");
    } else if ("envReport" in step) {
      const isSet = Object.hasOwn(process.env, step.envReport);
      await this.say(turn, `${step.envReport} is ${isSet ? "set" : "unset"}. `);
    } else {
      const imgs = turn.prompt.images;
      const desc = imgs.map((i) => `${i.mimeType} (${String(i.bytes)} bytes)`).join(", ");
      await this.say(turn, `Received ${String(imgs.length)} image(s): ${desc || "none"}. `);
    }
    return "next";
  }

  private async permission(
    p: { toolId: string; title: string; kind: acp.ToolKind; path: string },
    turn: TTurn,
    abs: (p: string) => string,
  ): Promise<"stop" | "next"> {
    const res = await this.conn.requestPermission({
      sessionId: turn.sessionId,
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
    if (res.outcome.optionId !== "reject") return "next";
    await this.toolStatus(turn, p.toolId, "failed");
    await this.say(turn, "Permission denied, so I left the file alone.");
    return "stop";
  }

  private async write(
    w: {
      path: string;
      content?: string | undefined;
      bytes?: number | undefined;
      toolId?: string | undefined;
    },
    turn: TTurn,
    abs: (p: string) => string,
  ): Promise<void> {
    const content = w.content ?? makeLines(w.bytes ?? 0);
    try {
      await this.conn.writeTextFile({ sessionId: turn.sessionId, path: abs(w.path), content });
      if (w.toolId !== undefined) await this.toolStatus(turn, w.toolId, "completed");
      await this.say(turn, `Wrote ${w.path}. `);
    } catch (e) {
      if (w.toolId !== undefined) await this.toolStatus(turn, w.toolId, "failed");
      await this.say(turn, `Write to ${w.path} was refused: ${errorMessage(e)}. `);
    }
  }
}

/**
 * The session's running token totals, as ACP reports them: one "token" per character, input
 * from the user's messages and output from the agent's replies, this turn's included.
 */
function usageOf(history: readonly { role: string; text: string }[], said: readonly string[]): acp.Usage {
  const inputTokens = history.filter((h) => h.role === "user").reduce((n, h) => n + h.text.length, 0);
  const outputTokens =
    history.filter((h) => h.role !== "user").reduce((n, h) => n + h.text.length, 0) +
    said.reduce((n, t) => n + t.length, 0);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
