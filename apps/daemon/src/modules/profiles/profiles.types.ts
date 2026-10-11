import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

/** Looks up how to run an agent (the agents module provides it). */
export interface IAgentSpecs {
  spec: (agent: string) => TAgentSpec;
}
