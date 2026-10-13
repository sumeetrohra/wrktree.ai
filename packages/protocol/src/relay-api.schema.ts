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
 * - every device (phone, browser, computer) signs in with Firebase and registers with its ID token
 *   as `Authorization: Bearer`;
 * - every device then uses its device token for the socket, push registration and `me`.
 */
export const relayRoutes = {
  register: { method: "POST", path: "/v1/devices/register" },
  devices: { method: "GET", path: "/v1/devices" },
  me: { method: "GET", path: "/v1/devices/me" },
  config: { method: "GET", path: "/v1/config" },
  pushRegister: { method: "POST", path: "/v1/push/register" },
  ws: { method: "GET", path: "/v1/ws" },
  /** Phase 3c: a computer opens a preview tunnel for one of its worktrees (device token). */
  preview: { method: "POST", path: "/v1/preview" },
  /** Phase 3c: and closes it (`/v1/preview/<token>`). */
  previewClose: { method: "DELETE", path: "/v1/preview" },
  devIdToken: { method: "GET", path: "/v1/dev/id-token" },
  devPushes: { method: "GET", path: "/v1/dev/pushes" },
  health: { method: "GET", path: "/health" },
} as const;

/**
 * A device proves it holds the signing key its id is derived from; `at` must be within five
 * minutes of the relay's clock. Every device registers with its ID token.
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

/**
 * The public client configuration every device needs, served so that a device only has to know the
 * relay's URL. `firebase` is null on a dev relay without Firebase (sign in with `devIdToken`).
 * `emulators` points at the Firebase Emulator Suite (dev relays only).
 */
export const relayConfigSchema = z.object({
  firebase: z
    .object({
      apiKey: z.string(),
      projectId: z.string(),
      storageBucket: z.string(),
      emulators: z
        .object({
          auth: z.string().optional(),
          firestore: z.string().optional(),
          storage: z.string().optional(),
        })
        .optional(),
    })
    .nullable(),
  devSignIn: z.boolean(),
});
export type TRelayConfig = z.infer<typeof relayConfigSchema>;

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

/**
 * Phase 3c, preview tunnel: a computer asks for a URL that reaches its worktree's dev server.
 * Only `allowedDeviceId` gets the one-time `key`, which the relay swaps for a cookie on first load.
 */
export const previewOpenBodySchema = z.object({
  worktreeId: z.string().min(1).max(64),
  allowedDeviceId: deviceIdSchema,
});
export const previewOpenResultSchema = z.object({
  token: z.string(),
  key: z.string(),
  url: z.string(),
  expiresAt: z.number(),
});
export type TPreviewOpenResult = z.infer<typeof previewOpenResultSchema>;

const headersSchema = z.record(z.string(), z.string());

/**
 * Preview frames travel between the relay and a computer as relay frames of kind `preview`
 * (`from: "relay"` one way, `to: "relay"` the other). They are not end-to-end encrypted: the
 * relay terminates TLS for the browser and must read them (SEC23). Bodies and data are base64.
 */
export const previewFrameSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("req"),
    id: z.string(),
    token: z.string(),
    method: z.string(),
    path: z.string(),
    headers: headersSchema,
    body: z.string().optional(),
  }),
  z.object({ t: z.literal("head"), id: z.string(), status: z.number().int(), headers: headersSchema }),
  z.object({ t: z.literal("chunk"), id: z.string(), data: z.string(), last: z.boolean() }),
  z.object({ t: z.literal("error"), id: z.string(), status: z.number().int(), message: z.string() }),
  /** The browser went away or the response grew past the limit: stop sending. */
  z.object({ t: z.literal("cancel"), id: z.string() }),
  z.object({
    t: z.literal("wsOpen"),
    id: z.string(),
    token: z.string(),
    path: z.string(),
    headers: headersSchema,
  }),
  z.object({ t: z.literal("wsData"), id: z.string(), data: z.string(), binary: z.boolean() }),
  z.object({ t: z.literal("wsClose"), id: z.string(), code: z.number().int().optional() }),
]);
export type TPreviewFrame = z.infer<typeof previewFrameSchema>;

/** The `to`/`from` a preview frame uses for the relay itself. */
export const RELAY_SELF = "relay";
