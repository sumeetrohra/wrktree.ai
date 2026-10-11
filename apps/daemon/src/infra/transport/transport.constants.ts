/** Per-connection limits for the local transport (SEC9). */
export const LIMITS = {
  /** Largest single WebSocket message; blob parts are 256 KB before base64. */
  frameBytes: 1024 * 1024,
  framesPerSecond: 400,
  concurrentUploads: 4,
  uploadBytes: 50 * 1024 * 1024,
  pendingUploadBytes: 64 * 1024 * 1024,
} as const;

/** Browsers can't set headers on a WebSocket, so the token may also travel as a subprotocol. */
export const TOKEN_PROTOCOL_PREFIX = "agentdeck.token.";
