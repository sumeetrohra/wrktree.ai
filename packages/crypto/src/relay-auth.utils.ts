import { framed, fromB64, toB64 } from "./bytes.utils.js";
import { LABELS } from "./crypto.constants.js";
import { deviceIdFor, sign, verify, type TIdentity } from "./keys.utils.js";

/** How far a signed relay request's `at` may drift from the relay's clock. */
export const RELAY_AUTH_SKEW_MS = 5 * 60 * 1000;

/** Signature proving a device holds the key behind its id (`POST /v1/devices/register`). */
export function signRegistration(
  me: TIdentity,
  at: number,
): { deviceId: string; signPub: string; at: number; sig: string } {
  const deviceId = deviceIdFor(me.signPub);
  return {
    deviceId,
    signPub: toB64(me.signPub),
    at,
    sig: toB64(sign(me, framed(LABELS.register, deviceId, String(at)))),
  };
}

export function verifyRegistration(
  body: { deviceId: string; signPub: string; at: number; sig: string },
  nowMs: number,
): boolean {
  if (Math.abs(nowMs - body.at) > RELAY_AUTH_SKEW_MS) return false;
  try {
    const pub = fromB64(body.signPub);
    if (deviceIdFor(pub) !== body.deviceId) return false;
    return verify(pub, framed(LABELS.register, body.deviceId, String(body.at)), fromB64(body.sig));
  } catch {
    return false;
  }
}

/** A host's proof, while it polls `POST /v1/link/poll`, that it is the device that started the link. */
export function signLinkPoll(me: TIdentity, linkId: string, at: number): string {
  return toB64(sign(me, framed(LABELS.linkPoll, linkId, String(at))));
}

export function verifyLinkPoll(
  signPub: string,
  linkId: string,
  at: number,
  sig: string,
  nowMs: number,
): boolean {
  if (Math.abs(nowMs - at) > RELAY_AUTH_SKEW_MS) return false;
  try {
    return verify(fromB64(signPub), framed(LABELS.linkPoll, linkId, String(at)), fromB64(sig));
  } catch {
    return false;
  }
}
