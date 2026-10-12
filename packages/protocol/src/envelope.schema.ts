import { z } from "zod";

import { protocolErrorSchema } from "./errors.schema.js";
import { daemonEventSchema, topicSchema } from "./events.schema.js";
import { cmdIdSchema, deviceIdSchema } from "./ids.schema.js";

/**
 * Outer frame, visible to the relay. For `msg`, `body` is the base64url sealed inner frame and
 * `sid` the session it was sealed under. `hs` (session handshake) and `pair` (pairing) carry
 * base64url JSON that is signed or MACed but not secret. `wake` is the one unencrypted hint the
 * relay acts on: it sends a content-free push when the recipient is offline.
 */
export const relayFrameSchema = z.object({
  v: z.literal(1),
  to: deviceIdSchema,
  from: deviceIdSchema,
  seq: z.number().int().nonnegative(),
  kind: z.enum(["msg", "ack", "ping", "hs", "pair"]),
  body: z.string(),
  /** Additive: session id the body was sealed under (`msg` only). */
  sid: z.string().optional(),
  /** Additive: ask the relay to push-wake an offline recipient. */
  wake: z.boolean().optional(),
});
export type TRelayFrame = z.infer<typeof relayFrameSchema>;

export const cmdFrameSchema = z.object({
  t: z.literal("cmd"),
  id: cmdIdSchema,
  name: z.string(),
  args: z.unknown(),
});
export const resOkFrameSchema = z.object({
  t: z.literal("res"),
  id: cmdIdSchema,
  ok: z.literal(true),
  data: z.unknown(),
});
export const resErrFrameSchema = z.object({
  t: z.literal("res"),
  id: cmdIdSchema,
  ok: z.literal(false),
  error: protocolErrorSchema,
});
export const evtFrameSchema = z.object({
  t: z.literal("evt"),
  topic: topicSchema,
  cursor: z.number().int(),
  event: daemonEventSchema,
});
export const blobFrameSchema = z.object({
  t: z.literal("blob"),
  blobId: z.string(),
  part: z.number().int().nonnegative(),
  last: z.boolean(),
  /** base64 */
  bytes: z.string(),
});

/** innerSchema frame: only phone and daemon can read it once Phase 2 adds encryption. */
export const innerSchema = z.union([
  cmdFrameSchema,
  resOkFrameSchema,
  resErrFrameSchema,
  evtFrameSchema,
  blobFrameSchema,
]);
export type TInner = z.infer<typeof innerSchema>;
export type TCmdFrame = z.infer<typeof cmdFrameSchema>;
export type TEvtFrame = z.infer<typeof evtFrameSchema>;
export type TBlobFrame = z.infer<typeof blobFrameSchema>;
export type TResFrame = z.infer<typeof resOkFrameSchema> | z.infer<typeof resErrFrameSchema>;

/** innerSchema frames above this size are sent as blob parts. */
export const FRAME_BLOB_THRESHOLD = 64 * 1024;
export const BLOB_PART_SIZE = 256 * 1024;

/**
 * A `res` whose data was too large to inline. The client reassembles the blob
 * frames with this id and parses them as the JSON value of `data`.
 */
export const blobbedDataSchema = z.object({ $blob: z.string() });
