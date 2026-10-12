import {
  AgentdeckError,
  type TBlobRef,
  type TChat,
  type TChatItem,
  type TChatStatus,
} from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import {
  ACP_PROTOCOL_VERSION,
  CLIENT_CAPABILITIES,
  spawnAdapter,
  type TAcpContentBlock,
  type TAdapter,
} from "#src/infra/acp/index.js";
import { childEnv } from "#src/infra/process/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import type { TAgentSpec } from "#src/shared/agent-spec.types.js";
import { DAEMON_VERSION } from "#src/shared/version.constants.js";

import { PermissionBroker } from "./permission-broker.js";
import type { TPermissionDecision, TSessionDeps } from "./sessions.types.js";
import { TurnMapper } from "./turn-mapper.js";

type TRow = {
  id: string;
  worktree_id: string;
  agent: string;
  profile_id: string;
  acp_session_id: string | null;
  title: string | null;
  status: TChatStatus;
  resumed: number;
  model: string | null;
  created_at: number;
  updated_at: number;
};

type TQueued = { turnId: string; text: string; attachments: TBlobRef[] };

/** One running adapter process and its ACP session, for one chat. */
type TLive = TAdapter & {
  chatId: string;
  spec: TAgentSpec;
  sessionId: string | null;
  mapper: TurnMapper;
  /** True while `session/load` replays history we already have in the event log. */
  loading: boolean;
  /** Set once the process is gone or being stopped; nothing else may touch it. */
  dead: boolean;
  /** Text of earlier turns, prepended to the next prompt after a resume without `session/load`. */
  seed: string | null;
  exited: Promise<void>;
};

const EXIT_GRACE_MS = 2000;
const SUMMARY_MESSAGES = 20;

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Relative form of an agent's absolute path when it is inside the worktree. */
function relPath(root: string, p: string): string {
  return p.startsWith(root)
    ? p
        .slice(root.length)
        .replace(/^[\\/]/, "")
        .replace(/\\/g, "/")
    : p;
}

/**
 * One AgentSession per chat: spawn, restart, resume, and the chat lifecycle state machine
 * (starting → idle ⇄ running ⇄ awaiting_permission, limited, crashed, stopped).
 */
export class SessionManager {
  private readonly live = new Map<string, TLive>();
  private readonly queues = new Map<string, TQueued[]>();
  private readonly restarts = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  readonly permissions: PermissionBroker;

  constructor(
    private readonly rt: TRuntime,
    private readonly deps: TSessionDeps,
  ) {
    this.permissions = new PermissionBroker(rt, {
      onPending: (chatId) => {
        this.setStatus(chatId, "awaiting_permission");
      },
      onResolved: (chatId) => {
        if (this.status(chatId) === "awaiting_permission") this.setStatus(chatId, "running");
      },
    });
  }

  // ---------- rows and events ----------

  private row(id: string): TRow {
    const r = this.rt.db.prepare<[string], TRow>("SELECT * FROM chats WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No chat ${id}`);
    return r;
  }

  private queue(chatId: string): TQueued[] {
    const existing = this.queues.get(chatId);
    if (existing) return existing;
    const created: TQueued[] = [];
    this.queues.set(chatId, created);
    return created;
  }

  private toChat(r: TRow): TChat {
    return {
      id: r.id,
      worktreeId: r.worktree_id,
      agent: r.agent,
      profileId: r.profile_id,
      title: r.title,
      status: r.status,
      resumed: r.resumed === 1,
      queued: this.queues.get(r.id)?.length ?? 0,
      model: r.model,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  get(id: string): TChat {
    return this.toChat(this.row(id));
  }

  list(worktreeId: string): TChat[] {
    this.deps.worktrees.get(worktreeId);
    return this.rt.db
      .prepare<[string], TRow>("SELECT * FROM chats WHERE worktree_id = ? ORDER BY created_at")
      .all(worktreeId)
      .map((r) => this.toChat(r));
  }

  private status(chatId: string): TChatStatus {
    return this.row(chatId).status;
  }

  private setStatus(chatId: string, status: TChatStatus, extra: { resetAt?: number } = {}): void {
    this.rt.db.prepare("UPDATE chats SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), chatId);
    this.rt.bus.publish(`chat:${chatId}`, {
      type: "chat.status",
      chatId,
      status,
      queued: this.queues.get(chatId)?.length ?? 0,
      ...extra,
    });
  }

  private system(chatId: string, text: string, level: "info" | "warn" | "error"): void {
    const item: TChatItem = { kind: "system", id: newId("item"), at: now(), text, level };
    this.rt.bus.publish(`chat:${chatId}`, { type: "chat.item", chatId, item });
  }

  private userItem(chatId: string, text: string, attachments: TBlobRef[]): void {
    this.rt.bus.publish(`chat:${chatId}`, {
      type: "chat.item",
      chatId,
      item: { kind: "user", id: newId("item"), at: now(), text, attachments },
    });
  }

  // ---------- commands ----------

  create(args: {
    worktreeId: string;
    agent: string;
    profileId: string;
    title?: string | undefined;
    model?: string | undefined;
  }): TChat {
    const wt = this.deps.worktrees.get(args.worktreeId);
    if (wt.status !== "ready")
      throw new AgentdeckError("BAD_STATE", `Worktree is ${wt.status}, not ready`, true);
    const profile = this.deps.profiles.get(args.profileId);
    if (profile.agent !== args.agent) {
      throw new AgentdeckError(
        "INVALID_ARGS",
        `Profile "${profile.name}" belongs to ${profile.agent}, not ${args.agent}`,
      );
    }
    this.deps.profiles.spec(args.agent);
    const id = newId("chat");
    const t = now();
    this.rt.db
      .prepare(
        `INSERT INTO chats (id, worktree_id, agent, profile_id, title, model, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'starting', ?, ?)`,
      )
      .run(id, args.worktreeId, args.agent, args.profileId, args.title ?? null, args.model ?? null, t, t);
    this.rt.bus.publish(`chat:${id}`, { type: "chat.status", chatId: id, status: "starting", queued: 0 });
    void this.start(id);
    return this.get(id);
  }

  send(chatId: string, text: string, attachments: TBlobRef[] = []): { turnId: string; queued: boolean } {
    const status = this.status(chatId);
    if (status === "crashed" || status === "stopped" || status === "limited") {
      throw new AgentdeckError("BAD_STATE", `Chat is ${status}`, status === "limited");
    }
    for (const a of attachments) this.deps.blobs.get(a.blobId);
    const turnId = newId("turn");
    this.userItem(chatId, text, attachments);
    this.queue(chatId).push({ turnId, text, attachments });
    const queued = status !== "idle";
    if (queued) this.setStatus(chatId, status);
    else this.drain(chatId);
    return { turnId, queued };
  }

  async cancel(chatId: string): Promise<void> {
    const status = this.status(chatId);
    this.queues.set(chatId, []);
    const live = this.live.get(chatId);
    if (!live || (status !== "running" && status !== "awaiting_permission")) {
      if (status === "idle") this.setStatus(chatId, "idle");
      return;
    }
    this.permissions.cancelChat(chatId);
    if (live.sessionId !== null) await live.conn.cancel({ sessionId: live.sessionId });
  }

  respond(chatId: string, requestId: string, decision: TPermissionDecision, message?: string): void {
    this.permissions.respond(chatId, requestId, decision);
    if (decision === "deny" && message) {
      // The agent ends its turn on a denial; the message becomes the next prompt.
      this.userItem(chatId, message, []);
      this.queue(chatId).unshift({ turnId: newId("turn"), text: message, attachments: [] });
    }
  }

  retry(chatId: string): TChat {
    if (this.status(chatId) !== "crashed")
      throw new AgentdeckError("BAD_STATE", "Only a crashed chat can be retried");
    this.restarts.set(chatId, 0);
    void this.start(chatId);
    return this.get(chatId);
  }

  // ---------- lifecycle ----------

  /** starting → idle: spawn the adapter, initialize, then session/load or session/new. */
  private async start(chatId: string): Promise<void> {
    const r = this.row(chatId);
    if (this.live.has(chatId)) return;
    if (r.status !== "starting") this.setStatus(chatId, "starting");
    const wt = this.deps.worktrees.get(r.worktree_id);
    let spec: TAgentSpec;
    try {
      spec = this.deps.profiles.spec(r.agent);
    } catch (e) {
      this.system(chatId, errorMessage(e), "error");
      this.setStatus(chatId, "crashed");
      return;
    }
    const live = this.spawn(chatId, spec, wt.path, r.profile_id, wt.id);
    try {
      const init = await live.conn.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "agentdeck", version: DAEMON_VERSION },
      });
      const canLoad = init.agentCapabilities?.loadSession === true;
      if (r.acp_session_id !== null && canLoad) await this.load(live, r.acp_session_id, wt.path);
      if (live.sessionId === null) await this.fresh(live, r.acp_session_id, wt.path);
      if (live.dead) return;
      this.setStatus(chatId, "idle");
      this.drain(chatId);
    } catch (e) {
      if (live.dead) return;
      this.onCrash(live, `${spec.displayName} failed to start: ${errorMessage(e)}`);
    }
  }

  private spawn(chatId: string, spec: TAgentSpec, cwd: string, profileId: string, worktreeId: string): TLive {
    let markExited: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      markExited = resolve;
    });
    const mapper = new TurnMapper(
      chatId,
      cwd,
      (e) => {
        this.rt.bus.publish(`chat:${chatId}`, e);
      },
      this.rt.opts.patchIntervalMs,
    );
    const state = { loading: false };
    const adapter = spawnAdapter(
      spec.command,
      cwd,
      childEnv(this.deps.profiles.env(profileId)),
      this.deps.files.filesFor(worktreeId),
      {
        sessionUpdate: (p) => {
          if (!state.loading) mapper.handle(p.update);
        },
        requestPermission: (p) => this.permissions.request(chatId, p, (path) => relPath(cwd, path)),
      },
    );
    const live: TLive = Object.assign(state, adapter, {
      chatId,
      spec,
      sessionId: null,
      mapper,
      dead: false,
      seed: null,
      exited,
    });
    this.live.set(chatId, live);
    live.proc.on("error", (e) => {
      this.onCrash(live, `Could not start ${spec.displayName}: ${e.message}`);
    });
    live.proc.on("exit", (code, signal) => {
      markExited();
      if (!live.dead) this.onCrash(live, `${spec.displayName} exited (${signal ?? `code ${String(code)}`})`);
    });
    return live;
  }

  private async load(live: TLive, sessionId: string, cwd: string): Promise<void> {
    live.loading = true;
    try {
      await live.conn.loadSession({ sessionId, cwd, mcpServers: [] });
      live.sessionId = sessionId;
    } catch (e) {
      this.rt.log.warn({ chatId: live.chatId, err: errorMessage(e) }, "session/load failed; starting fresh");
    } finally {
      live.loading = false;
    }
  }

  private async fresh(live: TLive, previousSessionId: string | null, cwd: string): Promise<void> {
    const res = await live.conn.newSession({ cwd, mcpServers: [] });
    live.sessionId = res.sessionId;
    if (previousSessionId !== null) {
      live.seed = this.transcriptSummary(live.chatId);
      this.rt.db.prepare("UPDATE chats SET resumed = 1 WHERE id = ?").run(live.chatId);
      this.system(
        live.chatId,
        "Resumed in a fresh agent session, seeded with a summary of this chat.",
        "warn",
      );
    }
    this.rt.db.prepare("UPDATE chats SET acp_session_id = ? WHERE id = ?").run(res.sessionId, live.chatId);
  }

  /** The last turns as plain text, for seeding a fresh session. */
  private transcriptSummary(chatId: string): string {
    const texts = new Map<string, { role: string; text: string }>();
    for (const { event } of this.rt.bus.replay(`chat:${chatId}`, 0)) {
      if (event.type === "chat.item" && (event.item.kind === "user" || event.item.kind === "agent_text")) {
        texts.set(event.item.id, {
          role: event.item.kind === "user" ? "User" : "Agent",
          text: event.item.text,
        });
      } else if (event.type === "chat.itemPatch") {
        const entry = texts.get(event.itemId);
        const text = event.patch.text;
        if (entry && typeof text === "string") entry.text = text;
      }
    }
    return [...texts.values()]
      .slice(-SUMMARY_MESSAGES)
      .map((t) => `${t.role}: ${t.text}`)
      .join("\n");
  }

  /** idle → running for the next queued message, if any. */
  private drain(chatId: string): void {
    const live = this.live.get(chatId);
    if (!live || live.dead || this.status(chatId) !== "idle") return;
    const next = this.queues.get(chatId)?.shift();
    if (next) void this.runTurn(live, next);
  }

  private prompt(live: TLive, msg: TQueued): TAcpContentBlock[] {
    const prompt: TAcpContentBlock[] = [];
    if (live.seed !== null) {
      prompt.push({
        type: "text",
        text: `Context from the earlier session of this chat:\n${live.seed}\n---\n`,
      });
      live.seed = null;
    }
    prompt.push({ type: "text", text: msg.text });
    for (const a of msg.attachments) {
      const { bytes, ref } = this.deps.blobs.get(a.blobId);
      if (ref.mime.startsWith("image/"))
        prompt.push({ type: "image", mimeType: ref.mime, data: bytes.toString("base64") });
    }
    return prompt;
  }

  private async runTurn(live: TLive, msg: TQueued): Promise<void> {
    const chatId = live.chatId;
    const sessionId = live.sessionId;
    if (sessionId === null) return;
    this.setStatus(chatId, "running");
    live.mapper.startTurn(msg.turnId);
    try {
      const res = await live.conn.prompt({ sessionId, prompt: this.prompt(live, msg) });
      if (live.dead) return;
      live.mapper.endTurn();
      if (res.stopReason === "cancelled") this.system(chatId, "Turn cancelled.", "info");
      else this.restarts.set(chatId, 0);
      this.setStatus(chatId, "idle");
      this.drain(chatId);
    } catch (e) {
      await this.onTurnError(live, e);
    }
  }

  private async onTurnError(live: TLive, e: unknown): Promise<void> {
    const chatId = live.chatId;
    if (live.dead) return;
    if (live.conn.signal.aborted) {
      // The adapter went away mid-turn; its exit handler reports the crash.
      await Promise.race([live.exited, new Promise((resolve) => setTimeout(resolve, EXIT_GRACE_MS))]);
      // The exit handler may have run during the wait; onCrash is a no-op if it did.
      this.onCrash(live, "The agent connection closed mid-turn");
      return;
    }
    live.mapper.endTurn();
    this.permissions.cancelChat(chatId);
    const limit = live.spec.detectLimit(e);
    if (limit.hit) {
      this.onLimit(chatId, this.row(chatId).profile_id, limit.resetAt);
      return;
    }
    this.system(chatId, `Agent error: ${errorMessage(e)}`, "error");
    this.setStatus(chatId, "idle");
    this.drain(chatId);
  }

  /** running → limited; back to idle once the reset time passes. */
  private onLimit(chatId: string, profileId: string, resetAt?: number): void {
    this.rt.db
      .prepare("INSERT INTO usage_samples (profile_id, at, limit_hit, reset_at) VALUES (?, ?, 1, ?)")
      .run(profileId, now(), resetAt ?? null);
    this.rt.bus.publish("global", {
      type: "usage.updated",
      profileId,
      usage: resetAt === undefined ? { limitHit: true } : { limitHit: true, resetAt },
    });
    const when = resetAt === undefined ? "an unknown time" : new Date(resetAt).toISOString();
    this.system(chatId, `Usage limit reached for this profile. It resets at ${when}.`, "warn");
    this.setStatus(chatId, "limited", resetAt === undefined ? {} : { resetAt });
    if (resetAt === undefined) return;
    const t = setTimeout(
      () => {
        this.timers.delete(chatId);
        if (this.status(chatId) !== "limited") return;
        this.rt.bus.publish("global", { type: "usage.updated", profileId, usage: { limitHit: false } });
        this.setStatus(chatId, "idle");
        this.drain(chatId);
      },
      Math.max(0, resetAt - now()),
    );
    this.timers.set(chatId, t);
  }

  /** running/starting → crashed, then automatic restarts with backoff (max 3). */
  private onCrash(live: TLive, reason: string): void {
    if (live.dead) return;
    live.dead = true;
    this.live.delete(live.chatId);
    live.mapper.endTurn();
    live.proc.kill("SIGKILL");
    this.permissions.cancelChat(live.chatId);
    const chatId = live.chatId;
    const tail = live.stderrTail();
    this.system(chatId, tail ? `${reason}\n${tail.split("\n").slice(-3).join("\n")}` : reason, "error");
    this.setStatus(chatId, "crashed");
    const attempt = this.restarts.get(chatId) ?? 0;
    const backoff = this.rt.opts.restartBackoffMs;
    const delay = backoff[attempt];
    if (delay === undefined) {
      this.system(
        chatId,
        `Gave up after ${String(backoff.length)} automatic restarts. Retry when the agent is fixed.`,
        "error",
      );
      return;
    }
    this.restarts.set(chatId, attempt + 1);
    const t = setTimeout(() => {
      this.timers.delete(chatId);
      if (this.status(chatId) !== "crashed") return;
      this.system(
        chatId,
        `Restarting the agent (attempt ${String(attempt + 1)} of ${String(backoff.length)}).`,
        "info",
      );
      void this.start(chatId);
    }, delay);
    this.timers.set(chatId, t);
  }

  /** Any status → stopped, killing the adapter. Used by archive, delete and shutdown. */
  private stop(chatId: string): void {
    const t = this.timers.get(chatId);
    if (t) clearTimeout(t);
    this.timers.delete(chatId);
    const live = this.live.get(chatId);
    if (live) {
      live.dead = true;
      this.live.delete(chatId);
      live.mapper.endTurn();
      this.permissions.cancelChat(chatId);
      live.proc.kill("SIGKILL");
    }
    if (this.status(chatId) !== "stopped") this.setStatus(chatId, "stopped");
  }

  stopWorktree(worktreeId: string): void {
    for (const c of this.list(worktreeId)) this.stop(c.id);
  }

  startWorktree(worktreeId: string): void {
    for (const c of this.list(worktreeId)) {
      this.restarts.set(c.id, 0);
      void this.start(c.id);
    }
  }

  deleteWorktreeChats(worktreeId: string): void {
    const ids = this.rt.db
      .prepare<[string], { id: string }>("SELECT id FROM chats WHERE worktree_id = ?")
      .all(worktreeId)
      .map((r) => r.id);
    for (const id of ids) {
      this.queues.delete(id);
      this.rt.db.prepare("DELETE FROM permission_rules WHERE chat_id = ?").run(id);
    }
    this.rt.db.prepare("DELETE FROM chats WHERE worktree_id = ?").run(worktreeId);
  }

  /** stopped → starting on daemon boot for every chat in a ready worktree. */
  boot(): void {
    const rows = this.rt.db
      .prepare<[], TRow & { wt_status: string }>(
        "SELECT c.*, w.status AS wt_status FROM chats c JOIN worktrees w ON w.id = c.worktree_id ORDER BY c.created_at",
      )
      .all();
    for (const r of rows) {
      if (r.wt_status !== "ready") {
        if (r.status !== "stopped") this.setStatus(r.id, "stopped");
        continue;
      }
      if (r.status === "running" || r.status === "awaiting_permission") {
        this.system(r.id, "The daemon restarted during a turn; that turn was interrupted.", "warn");
      }
      void this.start(r.id);
    }
  }

  shutdown(): void {
    for (const id of [...this.live.keys()]) this.stop(id);
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
