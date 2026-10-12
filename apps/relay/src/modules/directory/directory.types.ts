import type { TDeviceKind, TRegisterBody } from "@agentdeck/protocol";

import type { TRelayResult } from "#src/shared/failure.types.js";
import type { TIdentityClaims } from "#src/shared/id-token.types.js";

export type TDevice = {
  id: string;
  accountId: string;
  kind: TDeviceKind;
  name: string;
  signPub: string;
  createdAt: number;
};

/** A device joined (or rejoined) an account; `previousAccountId` is set when it moved accounts. */
export type TJoined = {
  deviceToken: string;
  accountId: string;
  kind: TDeviceKind;
  previousAccountId: string | null;
};

/**
 * Accounts and devices. Async throughout so the Worker can serve it from a Durable
 * Object over RPC; the self-host build calls the same class in process.
 */
export interface IDirectory {
  /** The account for a sign-in identity, created on first sight. */
  accountFor(claims: TIdentityClaims): Promise<string>;
  /** A device (host or consumer) joins the signed-in account. */
  register(body: TRegisterBody, accountId: string): Promise<TRelayResult<TJoined>>;
  deviceByToken(token: string): Promise<TDevice | null>;
  listDevices(accountId: string): Promise<TDevice[]>;
  /** Deletes the device and its token. It may join again, which is what signing in again means. */
  removeDevice(accountId: string, deviceId: string): Promise<TRelayResult<TDevice>>;
  recordPush(push: { deviceId: string; token: string; title: string; body: string }): Promise<void>;
  pushes(): Promise<{ deviceId: string; token: string; title: string; body: string; at: number }[]>;
}
