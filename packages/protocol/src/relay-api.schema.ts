import { z } from "zod";

import { deviceIdSchema } from "./ids.schema.js";
import { deviceKindSchema } from "./models.schema.js";

/**
 * The relay's HTTP API, shared by the relay, the daemon, the CLI and the app. Every body is
 * validated on both sides. Signatures and keys are base64url.
 */
const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");

/**
 * Who calls what:
 * - consumers (app, browser) sign in with Firebase and send its ID token as `Authorization: Bearer`;
 * - hosts (daemons) link with a device code a signed-in consumer approves, then use a device token;
 * - every device uses its device token for the socket, push registration and `me`.
 */
export const relayRoutes = {
  register: { method: "POST", path: "/v1/devices/register" },
  devices: { method: "GET", path: "/v1/devices" },
  me: { method: "GET", path: "/v1/devices/me" },
  linkStart: { method: "POST", path: "/v1/link/start" },
  linkApprove: { method: "POST", path: "/v1/link/approve" },
  linkPoll: { method: "POST", path: "/v1/link/poll" },
  pushRegister: { method: "POST", path: "/v1/push/register" },
  ws: { method: "GET", path: "/v1/ws" },
  devIdToken: { method: "GET", path: "/v1/dev/id-token" },
  devPushes: { method: "GET", path: "/v1/dev/pushes" },
  health: { method: "GET", path: "/health" },
} as const;

/**
 * A device proves it holds the signing key its id is derived from; `at` must be within five
 * minutes of the relay's clock. Consumers register with their ID token; hosts send the same body to
 * `link/start`.
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

/** A host asks to join an account; the user approves the code on a signed-in device. */
export const linkStartResultSchema = z.object({
  linkId: z.string(),
  /** Eight characters, shown as `ABCD-EFGH`. */
  code: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
  expiresAt: z.number(),
});
export const linkApproveBodySchema = z.object({ code: z.string().regex(/^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/) });
export const linkApproveResultSchema = z.object({ deviceId: deviceIdSchema, name: z.string() });
/** The host polls, signing like a registration, until the link is approved or expires. */
export const linkPollBodySchema = z.object({
  linkId: z.string(),
  deviceId: deviceIdSchema,
  at: z.number().int(),
  sig: b64,
});
export const linkPollResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("approved"), deviceToken: z.string(), accountEmail: z.string().nullable() }),
]);
export type TLinkPollResult = z.infer<typeof linkPollResultSchema>;

/** Dev only (`RELAY_DEV=1`): an ID token for any uid, signed by the relay's dev key. */
export const devIdTokenResultSchema = z.object({ idToken: z.string() });

/** `GET /v1/devices/me` with a device token: 200 while the device may connect, 401 once revoked. */
export const meResultSchema = z.object({ id: deviceIdSchema });

export const pushRegisterBodySchema = z.object({ expoPushToken: z.string().min(1).max(200) });

/** A device on the account. `signPub` is what hosts trust: the account's device list is the trust root. */
export const relayDeviceSchema = z.object({
  id: deviceIdSchema,
  kind: deviceKindSchema,
  name: z.string(),
  signPub: b64,
  connected: z.boolean(),
  createdAt: z.number(),
});
export type TRelayDevice = z.infer<typeof relayDeviceSchema>;
export const relayDevicesResultSchema = z.object({ devices: z.array(relayDeviceSchema) });

export const okResultSchema = z.object({ ok: z.literal(true) });
export const relayErrorSchema = z.object({ error: z.string() });

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
