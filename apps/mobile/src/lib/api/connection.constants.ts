import { z } from "zod";

/**
 * Where the daemon is. In development the web build talks to a local daemon; set
 * EXPO_PUBLIC_DAEMON_URL and EXPO_PUBLIC_DAEMON_TOKEN (from `local-token`). Phase 2 replaces this
 * with QR pairing through the relay.
 */
const envSchema = z.object({
  EXPO_PUBLIC_DAEMON_URL: z.url().default("ws://127.0.0.1:4317/v1/ws"),
  EXPO_PUBLIC_DAEMON_TOKEN: z.string().default(""),
});

const env = envSchema.parse({
  EXPO_PUBLIC_DAEMON_URL: process.env.EXPO_PUBLIC_DAEMON_URL,
  EXPO_PUBLIC_DAEMON_TOKEN: process.env.EXPO_PUBLIC_DAEMON_TOKEN,
});

export const DAEMON_URL = env.EXPO_PUBLIC_DAEMON_URL;
export const DAEMON_TOKEN = env.EXPO_PUBLIC_DAEMON_TOKEN;

/** The daemon accepts the token as a WebSocket subprotocol, because browsers can't set headers. */
export const TOKEN_PROTOCOL_PREFIX = "agentdeck.token.";
