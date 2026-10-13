/** Spec limits (docs/tech-spec.md, Relay). */
export const RELAY_LIMITS = {
  bufferFrames: 1000,
  bufferBytes: 10 * 1024 * 1024,
  bufferTtlMs: 7 * 24 * 60 * 60 * 1000,
  frameBytes: 1024 * 1024,
  phone: { framesPerSecond: 50, bytesPerSecond: 2 * 1024 * 1024 },
  daemon: { framesPerSecond: 200, bytesPerSecond: 8 * 1024 * 1024 },
  pushIntervalMs: 30 * 1000,
} as const;

/** WebSocket close codes the relay uses; clients reconnect on all but REVOKED. */
export const CLOSE = {
  RATE_LIMIT: 1008,
  TOO_BIG: 1009,
  REPLACED: 4000,
  MOVED: 4001,
  REVOKED: 4003,
} as const;

/** The push carries no content (spec: Push). */
export const PUSH_MESSAGE = { title: "Agentdeck", body: "A session needs you" } as const;

/** Preview tunnel (spec: Preview tunnelling). */
export const PREVIEW = {
  lifetimeMs: 8 * 60 * 60 * 1000,
  idleMs: 60 * 1000,
  maxResponseBytes: 25 * 1024 * 1024,
  maxBodyBytes: 10 * 1024 * 1024,
  /** A computer's preview frames, counted apart from its chat traffic. */
  rate: { framesPerSecond: 1000, bytesPerSecond: 64 * 1024 * 1024 },
} as const;
