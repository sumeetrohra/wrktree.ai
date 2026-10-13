import { AgentdeckError } from "@agentdeck/protocol";

import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

import { BUILT_IN_AGENTS, FAKE_AGENT } from "./agents.constants.js";

/** The agents this daemon can launch. */
export class AgentRegistry {
  private readonly specs = new Map<string, TAgentSpec>();

  /** `devAgentId`: the scripted test agent's id (store screenshots register it as a real one). */
  constructor(devAgents: boolean, devAgentId: string = FAKE_AGENT.id) {
    for (const s of BUILT_IN_AGENTS) this.specs.set(s.id, s);
    if (devAgents) this.specs.set(devAgentId, { ...FAKE_AGENT, id: devAgentId });
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
