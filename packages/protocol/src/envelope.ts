import { z } from "zod";
import { CmdId, DeviceId } from "./ids.js";
import { ProtocolError } from "./errors.js";
import { DaemonEvent, Topic } from "./events.js";

/** Outer frame, visible to the relay. Phase 2 encrypts `body`. */
export const RelayFrame = z.object({
  v: z.literal(1),
  to: DeviceId,
  from: DeviceId,
  seq: z.number().int().nonnegative(),
  kind: z.enum(["msg", "ack", "ping"]),
  body: z.string(),
});
export type RelayFrame = z.infer<typeof RelayFrame>;

export const CmdFrame = z.object({ t: z.literal("cmd"), id: CmdId, name: z.string(), args: z.unknown() });
export const ResOkFrame = z.object({
  t: z.literal("res"),
  id: CmdId,
  ok: z.literal(true),
  data: z.unknown(),
});
export const ResErrFrame = z.object({
  t: z.literal("res"),
  id: CmdId,
  ok: z.literal(false),
  error: ProtocolError,
});
export const EvtFrame = z.object({
  t: z.literal("evt"),
  topic: Topic,
  cursor: z.number().int(),
  event: DaemonEvent,
});
export const BlobFrame = z.object({
  t: z.literal("blob"),
  blobId: z.string(),
  part: z.number().int().nonnegative(),
  last: z.boolean(),
  /** base64 */
  bytes: z.string(),
});

/** Inner frame: only phone and daemon can read it once Phase 2 adds encryption. */
export const Inner = z.union([CmdFrame, ResOkFrame, ResErrFrame, EvtFrame, BlobFrame]);
export type Inner = z.infer<typeof Inner>;
export type CmdFrame = z.infer<typeof CmdFrame>;
export type EvtFrame = z.infer<typeof EvtFrame>;
export type BlobFrame = z.infer<typeof BlobFrame>;
export type ResFrame = z.infer<typeof ResOkFrame> | z.infer<typeof ResErrFrame>;

/** Inner frames above this size are sent as blob parts. */
export const FRAME_BLOB_THRESHOLD = 64 * 1024;
export const BLOB_PART_SIZE = 256 * 1024;

/**
 * A `res` whose data was too large to inline. The client reassembles the blob
 * frames with this id and parses them as the JSON value of `data`.
 */
export const BlobbedData = z.object({ $blob: z.string() });
