import { z } from "zod";

const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");

/** What the daemon's QR code (and the paste-able pairing link) carries. `secret` never touches the relay. */
export const pairingOfferSchema = z.object({
  v: z.literal(1),
  relayUrl: z.url(),
  pairingId: z.string().min(1),
  daemonDeviceId: z.string().min(1),
  daemonSignPub: b64,
  secret: b64,
});
export type TPairingOffer = z.infer<typeof pairingOfferSchema>;

/** Phone → daemon, sent through the relay once the pairing id is claimed. */
export const pairHelloSchema = z.object({
  t: z.literal("pair.hello"),
  pairingId: z.string().min(1),
  phoneDeviceId: z.string().min(1),
  phoneSignPub: b64,
  deviceName: z.string().max(100),
  mac: b64,
});
export type TPairHello = z.infer<typeof pairHelloSchema>;

/** Daemon → phone: proves the daemon in the QR code accepted this phone. */
export const pairOkSchema = z.object({ t: z.literal("pair.ok"), pairingId: z.string().min(1), sig: b64 });
export type TPairOk = z.infer<typeof pairOkSchema>;

export const pairRejectSchema = z.object({ t: z.literal("pair.reject"), pairingId: z.string().min(1) });

export const pairMessageSchema = z.discriminatedUnion("t", [pairHelloSchema, pairOkSchema, pairRejectSchema]);
export type TPairMessage = z.infer<typeof pairMessageSchema>;

export const handshakeMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("session.init"), sessionId: b64, ephPub: b64, sig: b64 }),
  z.object({ t: z.literal("session.accept"), sessionId: b64, ephPub: b64, sig: b64 }),
]);
export type THandshakeMessage = z.infer<typeof handshakeMessageSchema>;
