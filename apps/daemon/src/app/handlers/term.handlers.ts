import { AgentdeckError } from "@agentdeck/protocol";

import type { TCommandContext, THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";
import { isLocalDevice } from "../local-only.utils.js";

/**
 * Terminals (Phase 5). A shell runs anything the user could, with no approvals, so other devices
 * get one only when this computer's owner turned that on (`agentdeck config terminal remote on`;
 * SEC25). Clients on this computer always may.
 */
export function termHandlers(
  m: TModules,
): Pick<THandlers, "term.list" | "term.open" | "term.input" | "term.resize" | "term.close" | "term.output"> {
  const allowed = (ctx: TCommandContext): boolean => isLocalDevice(ctx) || m.remoteTerminal();
  const guard = (ctx: TCommandContext): void => {
    if (!allowed(ctx)) {
      throw new AgentdeckError(
        "UNAUTHORIZED",
        "Terminals from other devices are off on this computer. Turn them on there with `agentdeck config terminal remote on`.",
      );
    }
  };
  return {
    "term.list": (a, ctx) => ({ terminals: m.terminals.list(a.worktreeId), enabled: allowed(ctx) }),
    "term.open": (a, ctx) => {
      guard(ctx);
      return m.terminals.open(a.worktreeId, a.cols, a.rows);
    },
    "term.input": (a, ctx) => {
      guard(ctx);
      m.terminals.input(a.termId, a.data);
      return {};
    },
    "term.resize": (a, ctx) => {
      guard(ctx);
      return m.terminals.resize(a.termId, a.cols, a.rows);
    },
    "term.close": (a, ctx) => {
      guard(ctx);
      return m.terminals.close(a.termId);
    },
    "term.output": (a, ctx) => {
      guard(ctx);
      return m.terminals.output(a.termId);
    },
  };
}
