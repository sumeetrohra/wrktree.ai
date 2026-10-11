import { z } from "zod";

export const errorCodeSchema = z.enum([
  "INVALID_ARGS",
  "UNKNOWN_COMMAND",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "CONFLICT",
  "BAD_STATE",
  "FORBIDDEN_PATH",
  "NOT_A_REPO",
  "GIT_FAILED",
  "UNKNOWN_AGENT",
  "AGENT_LIMIT",
  "AGENT_CRASHED",
  "PORTS_EXHAUSTED",
  "TOO_LARGE",
  "INTERNAL",
]);
export type TErrorCode = z.infer<typeof errorCodeSchema>;

export const protocolErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type TProtocolError = z.infer<typeof protocolErrorSchema>;

/** Thrown inside the daemon; the router turns it into a `TProtocolError` reply. */
export class AgentdeckError extends Error {
  constructor(
    readonly code: TErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentdeckError";
  }

  toProtocol(): TProtocolError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
