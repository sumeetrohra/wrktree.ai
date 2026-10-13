import { AgentdeckError } from "@agentdeck/protocol";

import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";
import { handoffBrief } from "../handoff.utils.js";

/**
 * Phase 4b: continue a chat on another profile, agent or model in the same worktree. The new chat
 * opens with a brief of the old one and the user's unsent messages; the old one notes where it went.
 */
export function handoffHandlers(m: TModules): Pick<THandlers, "chat.handoff"> {
  return {
    "chat.handoff": async (a) => {
      const old = m.sessions.get(a.chatId);
      const profile = m.profiles.get(a.profileId);
      if (a.agent !== undefined && a.agent !== profile.agent) {
        throw new AgentdeckError(
          "INVALID_ARGS",
          `Profile "${profile.name}" belongs to ${profile.agent}, not ${a.agent}`,
        );
      }
      if (profile.id === old.profileId && (a.model ?? null) === (old.model ?? null)) {
        throw new AgentdeckError("INVALID_ARGS", "The chat already runs on that profile and model");
      }
      const wt = m.worktrees.get(old.worktreeId);
      const diff = await m.git.summary(wt, m.jailFor(wt.id)).catch(() => null);
      // The old chat's unsent messages move to the new chat after the brief, in order.
      const unsent = m.sessions.takeQueue(old.id);
      const context = m.sessions.handoffContext(old.id, unsent.length);
      const fromProfile = m.profiles.get(old.profileId);
      const brief = handoffBrief({
        ...context,
        from: { agent: old.agent, profile: fromProfile.name, limited: old.status === "limited" },
        diff,
        unsent: [],
      });
      const chat = m.sessions.create({
        worktreeId: old.worktreeId,
        agent: profile.agent,
        profileId: profile.id,
        title: old.title ?? undefined,
        model: a.model,
        handedOffFrom: old.id,
      });
      m.sessions.send(chat.id, brief);
      for (const text of unsent) m.sessions.send(chat.id, text);
      m.sessions.note(chat.id, `Continued from a chat on ${fromProfile.name} (${old.agent}).`);
      m.sessions.note(old.id, `Continued in a new chat on ${profile.name} (${profile.agent}).`);
      return m.sessions.get(chat.id);
    },
  };
}
