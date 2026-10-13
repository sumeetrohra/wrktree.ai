import { AgentdeckError } from "@agentdeck/protocol";
import { parsePrDraft, PR_DRAFT_REQUEST } from "@agentdeck/shared";

import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

import { assertAgentsQuiet } from "./git.handlers.js";

const DRAFT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Sends the fixed PR-draft request to the chat's agent and resolves with its reply once the turn
 * ends: the last agent message, read as `Title: …` + body.
 */
async function draft(m: TModules, chatId: string): Promise<{ title: string; body: string }> {
  const chat = m.sessions.get(chatId);
  if (chat.status !== "idle") {
    throw new AgentdeckError("BAD_STATE", "The agent is busy; ask for a draft when it's idle", true);
  }
  const topic = `chat:${chatId}`;
  const from = m.bus.cursor(topic);
  const ended = new Promise<void>((resolve, reject) => {
    let started = false;
    const timer = setTimeout(() => {
      off();
      reject(new AgentdeckError("BAD_STATE", "The agent took too long to draft the PR", true));
    }, DRAFT_TIMEOUT_MS);
    const off = m.bus.on((e) => {
      if (e.topic !== topic || e.event.type !== "chat.status") return;
      const s = e.event.status;
      if (s === "running") started = true;
      else if (s === "idle" && started) {
        clearTimeout(timer);
        off();
        resolve();
      } else if (s === "crashed" || s === "limited" || s === "stopped") {
        clearTimeout(timer);
        off();
        reject(new AgentdeckError("AGENT_CRASHED", `The agent ${s} while drafting the PR`));
      }
    });
  });
  m.sessions.send(chatId, PR_DRAFT_REQUEST);
  await ended;
  const texts = new Map<string, string>();
  for (const { event } of m.bus.replay(topic, from)) {
    if (event.type === "chat.item" && event.item.kind === "agent_text")
      texts.set(event.item.id, event.item.text);
    if (event.type === "chat.itemPatch" && texts.has(event.itemId) && event.patch.text !== undefined) {
      texts.set(event.itemId, event.patch.text);
    }
  }
  const reply = [...texts.values()].at(-1) ?? "";
  const parsed = parsePrDraft(reply);
  if (!parsed.title) throw new AgentdeckError("BAD_STATE", "The agent's reply had no PR title");
  return parsed;
}

export function prHandlers(
  m: TModules,
): Pick<THandlers, "pr.status" | "pr.create" | "pr.merge" | "pr.draft"> {
  return {
    "pr.status": (a) => m.github.status(m.worktrees.get(a.worktreeId)),
    "pr.create": (a) => {
      assertAgentsQuiet(m, a.worktreeId);
      return m.github.create(m.worktrees.get(a.worktreeId), a.title, a.body, a.draft);
    },
    "pr.merge": (a) => m.github.merge(m.worktrees.get(a.worktreeId), a.method),
    "pr.draft": (a) => draft(m, a.chatId),
  };
}
