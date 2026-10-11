import { AgentdeckError } from "@agentdeck/protocol";

import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

import { BUILT_IN_AGENTS, FAKE_AGENT } from "./agents.constants.js";

/** The agents this daemon can launch. */
export class AgentRegistry {
  private readonly specs = new Map<string, TAgentSpec>();

  constructor(devAgents: boolean) {
    for (const s of BUILT_IN_AGENTS) this.specs.set(s.id, s);
    if (devAgents) this.specs.set(FAKE_AGENT.id, FAKE_AGENT);
  }

  /** The spec for `id`, or UNKNOWN_AGENT. */
  spec(id: string): TAgentSpec {
    const s = this.specs.get(id);
    if (!s)
      throw new AgentdeckError("UNKNOWN_AGENT", `Unknown agent: ${id}. Known: ${this.ids().join(", ")}`);
    return s;
  }

  ids(): string[] {
    return [...this.specs.keys()];
  }
}
