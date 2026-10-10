import type { ChildProcess } from "node:child_process";
import { AgentdeckError, type BlobRef, type Chat, type ChatItem, type ChatStatus } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";
import type { Ctx } from "../../context.js";
import type { BlobStore } from "../blobs.js";
import type { FileJail } from "../files.js";
import type { Profiles } from "../profiles.js";
import type { Worktrees } from "../worktrees.js";
import { acp, CLIENT_CAPABILITIES, spawnAdapter } from "./acp-client.js";
import type { AgentSpec } from "./agents.js";
import { TurnMapper } from "./mapper.js";
import { PermissionBroker } from "./permissions.js";

type Row = {
  id: string;
  worktree_id: string;
  agent: string;
  profile_id: string;
  acp_session_id: string | null;
  title: string | null;
  status: ChatStatus;
  resumed: number;
  created_at: number;
  updated_at: number;
};

type Queued = { turnId: string; text: string; attachments: BlobRef[] };

/** One running adapter process and its ACP session, for one chat. */
type Live = {
  chatId: string;
  proc: ChildProcess;
  conn: acp.ClientSideConnection;
  stderrTail(): string;
  sessionId: string | null;
  mapper: TurnMapper;
  jail: FileJail;
  /** True while `session/load` replays history we already have in the event log. */
  loading: boolean;
  /** Set once the process is gone or being stopped; nothing else may touch it. */
  dead: boolean;
  /** Text of earlier turns, prepended to the next prompt after a resume without `session/load`. */
  seed: string | null;
  exited: Promise<void>;
};

export type SessionDeps = {
  profiles: Profiles;
  worktrees: Worktrees;
  blobs: BlobStore;
  jailFor(worktreeId: string): FileJail;
};

/**
 * One AgentSession per chat: spawn, restart, resume, and the chat lifecycle
 * state machine (starting → idle ⇄ running ⇄ awaiting_permission, limited,
 * crashed, stopped).
 */
export class SessionManager {
  private live = new Map<string, Live>();
  private queues = new Map<string, Queued[]>();
  private restarts = new Map<string, number>();
  private timers = new Map<string, NodeJS.Timeout>();
  readonly permissions: PermissionBroker;

  constructor(
    private readonly ctx: Ctx,
    private readonly deps: SessionDeps,
  ) {
    this.permissions = new PermissionBroker(ctx, {
      onPending: (chatId) => this.setStatus(chatId, "awaiting_permission"),
      onResolved: (chatId) => {
        if (this.status(chatId) === "awaiting_permission") this.setStatus(chatId, "running");
      },
    });
  }

  // ---------- rows and events ----------

  private row(id: string): Row {
    const r = this.ctx.db.prepare<[string], Row>("SELECT * FROM chats WHERE id = ?").get(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No chat ${id}`);
    return r;
  }

  private toChat(r: Row): Chat {
    return {
      id: r.id,
      worktreeId: r.worktree_id,
      agent: r.agent,
      profileId: r.profile_id,
      title: r.title,
      status: r.status,
      resumed: r.resumed === 1,
      queued: this.queues.get(r.id)?.length ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  get(id: string): Chat {
    return this.toChat(this.row(id));
  }

  list(worktreeId: string): Chat[] {
    this.deps.worktrees.get(worktreeId);
    return this.ctx.db
      .prepare<[string], Row>("SELECT * FROM chats WHERE worktree_id = ? ORDER BY created_at")
      .all(worktreeId)
      .map((r) => this.toChat(r));
  }

  private status(chatId: string): ChatStatus {
    return this.row(chatId).status;
  }

  private setStatus(chatId: string, status: ChatStatus, extra: { resetAt?: number } = {}): void {
    this.ctx.db
      .prepare("UPDATE chats SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), chatId);
    this.ctx.bus.publish(`chat:${chatId}`, {
      type: "chat.status",
      chatId,
      status,
      queued: this.queues.get(chatId)?.length ?? 0,
      ...extra,
    });
  }

  private system(chatId: string, text: string, level: "info" | "warn" | "error"): void {
    const item: ChatItem = { kind: "system", id: newId("item"), at: now(), text, level };
    this.ctx.bus.publish(`chat:${chatId}`, { type: "chat.item", chatId, item });
  }

  // ---------- commands ----------

  create(args: { worktreeId: string; agent: string; profileId: string; title?: string }): Chat {
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
    this.ctx.db
      .prepare(
        `INSERT INTO chats (id, worktree_id, agent, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'starting', ?, ?)`,
      )
      .run(id, args.worktreeId, args.agent, args.profileId, args.title ?? null, t, t);
    this.ctx.bus.publish(`chat:${id}`, { type: "chat.status", chatId: id, status: "starting", queued: 0 });
    void this.start(id);
    return this.get(id);
  }

  send(chatId: string, text: string, attachments: BlobRef[] = []): { turnId: string; queued: boolean } {
    const status = this.status(chatId);
    if (status === "crashed" || status === "stopped" || status === "limited") {
      throw new AgentdeckError("BAD_STATE", `Chat is ${status}`, status === "limited");
    }
    for (const a of attachments) this.deps.blobs.get(a.blobId);
    const turnId = newId("turn");
    this.ctx.bus.publish(`chat:${chatId}`, {
      type: "chat.item",
      chatId,
      item: { kind: "user", id: newId("item"), at: now(), text, attachments },
    });
    const queue = this.queues.get(chatId) ?? [];
    this.queues.set(chatId, queue);
    queue.push({ turnId, text, attachments });
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
    if (live.sessionId) await live.conn.cancel({ sessionId: live.sessionId });
  }

  respond(
    chatId: string,
    requestId: string,
    decision: "allow_once" | "allow_always" | "deny",
    message?: string,
  ): void {
    this.permissions.respond(chatId, requestId, decision);
    if (decision === "deny" && message) {
      // The agent ends its turn on a denial; the message becomes the next prompt.
      this.ctx.bus.publish(`chat:${chatId}`, {
        type: "chat.item",
        chatId,
        item: { kind: "user", id: newId("item"), at: now(), text: message, attachments: [] },
      });
      const queue = this.queues.get(chatId) ?? [];
      this.queues.set(chatId, queue);
      queue.unshift({ turnId: newId("turn"), text: message, attachments: [] });
    }
  }

  retry(chatId: string): Chat {
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
    let spec: AgentSpec;
    try {
      spec = this.deps.profiles.spec(r.agent);
    } catch (e) {
      this.system(chatId, (e as Error).message, "error");
      this.setStatus(chatId, "crashed");
      return;
    }
    const jail = this.deps.jailFor(wt.id);
    let markExited = () => {};
    const live: Live = {
      exited: new Promise<void>((r) => (markExited = r)),
      chatId,
      sessionId: null,
      mapper: new TurnMapper(
        chatId,
        wt.path,
        (e) => this.ctx.bus.publish(`chat:${chatId}`, e),
        this.ctx.opts.patchIntervalMs,
      ),
      jail,
      loading: false,
      dead: false,
      seed: null,
      ...spawnAdapter(spec.command, wt.path, this.deps.profiles.env(r.profile_id), jail, {
        sessionUpdate: (p) => {
          if (!live.loading) live.mapper.handle(p.update);
        },
        requestPermission: (p) => this.permissions.request(chatId, p, (path) => this.relPath(wt.path, path)),
      }),
    };
    this.live.set(chatId, live);
    live.proc.on("error", (e) => this.onCrash(live, `Could not start ${spec.displayName}: ${e.message}`));
    live.proc.on("exit", (code, signal) => {
      markExited();
      if (!live.dead) this.onCrash(live, `${spec.displayName} exited (${signal ?? `code ${code}`})`);
    });

    try {
      const init = await live.conn.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "agentdeck", version: "0.1.0" },
      });
      const canLoad = init.agentCapabilities?.loadSession === true;
      if (r.acp_session_id && canLoad) {
        live.loading = true;
        try {
          await live.conn.loadSession({ sessionId: r.acp_session_id, cwd: wt.path, mcpServers: [] });
          live.sessionId = r.acp_session_id;
        } catch (e) {
          this.ctx.log.warn({ chatId, err: (e as Error).message }, "session/load failed; starting fresh");
        } finally {
          live.loading = false;
        }
      }
      if (!live.sessionId) {
        const res = await live.conn.newSession({ cwd: wt.path, mcpServers: [] });
        live.sessionId = res.sessionId;
        if (r.acp_session_id) {
          live.seed = this.transcriptSummary(chatId);
          this.ctx.db.prepare("UPDATE chats SET resumed = 1 WHERE id = ?").run(chatId);
          this.system(
            chatId,
            "Resumed in a fresh agent session, seeded with a summary of this chat.",
            "warn",
          );
        }
        this.ctx.db.prepare("UPDATE chats SET acp_session_id = ? WHERE id = ?").run(live.sessionId, chatId);
      }
      if (live.dead) return;
      this.setStatus(chatId, "idle");
      this.drain(chatId);
    } catch (e) {
      if (live.dead) return;
      const msg = (e as { message?: string }).message ?? String(e);
      this.onCrash(live, `${spec.displayName} failed to start: ${msg}`);
    }
  }

  private relPath(root: string, p: string): string {
    return p.startsWith(root)
      ? p
          .slice(root.length)
          .replace(/^[\\/]/, "")
          .replace(/\\/g, "/")
      : p;
  }

  /** The last turns as plain text, for seeding a fresh session. */
  private transcriptSummary(chatId: string): string {
    const lines: string[] = [];
    const texts = new Map<string, { role: string; text: string }>();
    for (const e of this.ctx.bus.replay(`chat:${chatId}`, 0)) {
      if (
        e.event.type === "chat.item" &&
        (e.event.item.kind === "user" || e.event.item.kind === "agent_text")
      ) {
        texts.set(e.event.item.id, {
          role: e.event.item.kind === "user" ? "User" : "Agent",
          text: e.event.item.text,
        });
      } else if (
        e.event.type === "chat.itemPatch" &&
        texts.has(e.event.itemId) &&
        typeof e.event.patch.text === "string"
      ) {
        texts.get(e.event.itemId)!.text = e.event.patch.text;
      }
    }
    for (const t of [...texts.values()].slice(-20)) lines.push(`${t.role}: ${t.text}`);
    return lines.join("\n");
  }

  /** idle → running for the next queued message, if any. */
  private drain(chatId: string): void {
    const live = this.live.get(chatId);
    const queue = this.queues.get(chatId);
    if (!live || live.dead || !queue?.length || this.status(chatId) !== "idle") return;
    const next = queue.shift()!;
    void this.runTurn(live, next);
  }

  private async runTurn(live: Live, msg: Queued): Promise<void> {
    const chatId = live.chatId;
    this.setStatus(chatId, "running");
    live.mapper.startTurn(msg.turnId);
    const prompt: acp.ContentBlock[] = [];
    if (live.seed) {
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
    try {
      const res = await live.conn.prompt({ sessionId: live.sessionId!, prompt });
      if (live.dead) return;
      live.mapper.endTurn();
      if (res.stopReason === "cancelled") this.system(chatId, "Turn cancelled.", "info");
      else this.restarts.set(chatId, 0);
      this.setStatus(chatId, "idle");
      this.drain(chatId);
    } catch (e) {
      if (live.dead) return;
      if (live.conn.signal.aborted) {
        // The adapter went away mid-turn; its exit handler reports the crash.
        await Promise.race([live.exited, new Promise((r) => setTimeout(r, 2000))]);
        if (!live.dead) this.onCrash(live, "The agent connection closed mid-turn");
        return;
      }
      live.mapper.endTurn();
      this.permissions.cancelChat(chatId);
      const r = this.row(chatId);
      const limit = this.deps.profiles.spec(r.agent).detectLimit(e);
      if (limit.hit) {
        this.onLimit(chatId, r.profile_id, limit.resetAt);
        return;
      }
      this.system(chatId, `Agent error: ${(e as Error).message ?? String(e)}`, "error");
      this.setStatus(chatId, "idle");
      this.drain(chatId);
    }
  }

  /** running → limited; back to idle once the reset time passes. */
  private onLimit(chatId: string, profileId: string, resetAt?: number): void {
    this.ctx.db
      .prepare("INSERT INTO usage_samples (profile_id, at, limit_hit, reset_at) VALUES (?, ?, 1, ?)")
      .run(profileId, now(), resetAt ?? null);
    this.ctx.bus.publish("global", {
      type: "usage.updated",
      profileId,
      usage: { limitHit: true, ...(resetAt ? { resetAt } : {}) },
    });
    const when = resetAt ? new Date(resetAt).toISOString() : "an unknown time";
    this.system(chatId, `Usage limit reached for this profile. It resets at ${when}.`, "warn");
    this.setStatus(chatId, "limited", resetAt ? { resetAt } : {});
    if (resetAt) {
      const t = setTimeout(
        () => {
          this.timers.delete(chatId);
          if (this.status(chatId) !== "limited") return;
          this.ctx.bus.publish("global", { type: "usage.updated", profileId, usage: { limitHit: false } });
          this.setStatus(chatId, "idle");
          this.drain(chatId);
        },
        Math.max(0, resetAt - now()),
      );
      this.timers.set(chatId, t);
    }
  }

  /** running/starting → crashed, then automatic restarts with backoff (max 3). */
  private onCrash(live: Live, reason: string): void {
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
    const backoff = this.ctx.opts.restartBackoffMs;
    if (attempt >= backoff.length) {
      this.system(
        chatId,
        `Gave up after ${backoff.length} automatic restarts. Retry when the agent is fixed.`,
        "error",
      );
      return;
    }
    this.restarts.set(chatId, attempt + 1);
    const t = setTimeout(() => {
      this.timers.delete(chatId);
      if (this.status(chatId) !== "crashed") return;
      this.system(chatId, `Restarting the agent (attempt ${attempt + 1} of ${backoff.length}).`, "info");
      void this.start(chatId);
    }, backoff[attempt]);
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

  async stopWorktree(worktreeId: string): Promise<void> {
    for (const c of this.list(worktreeId)) this.stop(c.id);
  }

  async startWorktree(worktreeId: string): Promise<void> {
    for (const c of this.list(worktreeId)) {
      this.restarts.set(c.id, 0);
      void this.start(c.id);
    }
  }

  deleteWorktreeChats(worktreeId: string): void {
    const ids = this.ctx.db
      .prepare<[string], { id: string }>("SELECT id FROM chats WHERE worktree_id = ?")
      .all(worktreeId)
      .map((r) => r.id);
    for (const id of ids) {
      this.queues.delete(id);
      this.ctx.db.prepare("DELETE FROM permission_rules WHERE chat_id = ?").run(id);
    }
    this.ctx.db.prepare("DELETE FROM chats WHERE worktree_id = ?").run(worktreeId);
  }

  /** stopped → starting on daemon boot for every chat in a ready worktree. */
  boot(): void {
    const rows = this.ctx.db
      .prepare<[], Row & { wt_status: string }>(
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
