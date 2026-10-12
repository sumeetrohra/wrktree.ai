import { z } from "zod";

const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");

/** The signed ephemeral handshake that opens every session (body of an `hs` relay frame). */
export const handshakeMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("session.init"), sessionId: b64, ephPub: b64, sig: b64 }),
  z.object({ t: z.literal("session.accept"), sessionId: b64, ephPub: b64, sig: b64 }),
]);
export type THandshakeMessage = z.infer<typeof handshakeMessageSchema>;
