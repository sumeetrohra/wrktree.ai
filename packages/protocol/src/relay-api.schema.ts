import { z } from "zod";

import { deviceIdSchema } from "./ids.schema.js";
import { deviceKindSchema } from "./models.schema.js";

/**
 * The relay's HTTP API, shared by the relay, the daemon, the CLI and the app. Every body is
 * validated on both sides. Signatures and keys are base64url.
 */
const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");
const email = z.email().max(254);

export const relayRoutes = {
  authStart: { method: "POST", path: "/v1/auth/start" },
  authFinish: { method: "POST", path: "/v1/auth/finish" },
  authRefresh: { method: "POST", path: "/v1/auth/refresh" },
  githubStart: { method: "POST", path: "/v1/auth/github/start" },
  githubFinish: { method: "POST", path: "/v1/auth/github/finish" },
  register: { method: "POST", path: "/v1/devices/register" },
  devices: { method: "GET", path: "/v1/devices" },
  pairOffer: { method: "POST", path: "/v1/pair/offer" },
  pairClaim: { method: "POST", path: "/v1/pair/claim" },
  pushRegister: { method: "POST", path: "/v1/push/register" },
  ws: { method: "GET", path: "/v1/ws" },
  devOutbox: { method: "GET", path: "/v1/dev/outbox" },
  devPushes: { method: "GET", path: "/v1/dev/pushes" },
  devGithub: { method: "GET", path: "/v1/dev/github" },
  health: { method: "GET", path: "/health" },
} as const;

/** Magic link: the relay mails a one-time code. */
export const authStartBodySchema = z.object({ email });
export const authFinishBodySchema = z.object({ email, code: z.string().regex(/^\d{6}$/) });
/** Account session: a rotating JWT, sent as `Authorization: Bearer`. */
export const authSessionSchema = z.object({
  accountId: z.string(),
  sessionToken: z.string(),
  expiresAt: z.number(),
});
export type TAuthSession = z.infer<typeof authSessionSchema>;

export const githubStartResultSchema = z.object({ url: z.url(), state: z.string() });
export const githubFinishBodySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

/**
 * A device proves it holds the signing key its id is derived from. `at` must be within five
 * minutes of the relay's clock. With an account session header (phone), the device joins that
 * account; without one (daemon), it stays unowned until a phone claims its pairing offer.
 */
export const registerBodySchema = z.object({
  deviceId: deviceIdSchema,
  signPub: b64,
  kind: deviceKindSchema,
  name: z.string().min(1).max(100),
  at: z.number().int(),
  sig: b64,
});
export type TRegisterBody = z.infer<typeof registerBodySchema>;
export const registerResultSchema = z.object({ deviceToken: z.string() });

export const pairOfferResultSchema = z.object({ pairingId: z.string(), expiresAt: z.number() });
export const pairClaimBodySchema = z.object({ pairingId: z.string().min(1), phoneDeviceId: deviceIdSchema });
export const pairClaimResultSchema = z.object({ daemonDeviceId: deviceIdSchema });

export const pushRegisterBodySchema = z.object({ expoPushToken: z.string().min(1).max(200) });

export const relayDeviceSchema = z.object({
  id: deviceIdSchema,
  kind: deviceKindSchema,
  name: z.string(),
  connected: z.boolean(),
  createdAt: z.number(),
});
export type TRelayDevice = z.infer<typeof relayDeviceSchema>;
export const relayDevicesResultSchema = z.object({ devices: z.array(relayDeviceSchema) });

/** Revoking needs the daemon's signature over the revoked id, so a stolen account session can't. */
export const revokeBodySchema = z.object({ daemonDeviceId: deviceIdSchema, at: z.number().int(), sig: b64 });

export const okResultSchema = z.object({ ok: z.literal(true) });
export const relayErrorSchema = z.object({ error: z.string() });

/** Dev-only inspection endpoints (enabled with RELAY_DEV=1). */
export const devOutboxResultSchema = z.object({
  messages: z.array(z.object({ to: z.string(), code: z.string(), at: z.number() })),
});
export const devPushesResultSchema = z.object({
  pushes: z.array(
    z.object({
      deviceId: z.string(),
      token: z.string(),
      title: z.string(),
      body: z.string(),
      at: z.number(),
    }),
  ),
});

/** Relay → device control frames on the WebSocket (not end-to-end; they carry no content). */
export const relayControlSchema = z.discriminatedUnion("t", [
  /** Frames to this device were dropped (buffer full or expired); resync with `sync.hello`. */
  z.object({ t: z.literal("relay.gap"), from: deviceIdSchema }),
  /** The peer this frame was for doesn't exist or isn't on the account. */
  z.object({ t: z.literal("relay.undeliverable"), to: deviceIdSchema, seq: z.number().int() }),
  /** Another device of the account came online or went offline. */
  z.object({ t: z.literal("relay.presence"), deviceId: deviceIdSchema, online: z.boolean() }),
  /**
   * Sent right before the relay closes the socket, with the close code. Clients close on it
   * themselves, because some runtimes don't deliver a server-initiated close promptly.
   */
  z.object({ t: z.literal("relay.closed"), code: z.number().int(), reason: z.string() }),
]);
export type TRelayControl = z.infer<typeof relayControlSchema>;

/** Subprotocol carrying a device token from browsers, which can't set WebSocket headers. */
export const RELAY_TOKEN_PROTOCOL_PREFIX = "agentdeck.token.";
export const RELAY_WS_PROTOCOL = "agentdeck.relay.v1";
