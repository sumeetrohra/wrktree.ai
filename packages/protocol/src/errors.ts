import { z } from "zod";

export const ErrorCode = z.enum([
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
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ProtocolError = z.object({
  code: ErrorCode,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ProtocolError = z.infer<typeof ProtocolError>;

/** Thrown inside the daemon; the router turns it into a `ProtocolError` reply. */
export class AgentdeckError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentdeckError";
  }

  toProtocol(): ProtocolError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
