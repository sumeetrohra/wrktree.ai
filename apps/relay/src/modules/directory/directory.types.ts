import type { TDeviceKind, TRegisterBody } from "@agentdeck/protocol";

import type { TRelayResult } from "#src/shared/failure.types.js";

export type TDevice = {
  id: string;
  accountId: string;
  kind: TDeviceKind;
  name: string;
  signPub: string;
  createdAt: number;
  revokedAt: number | null;
};

export type TRegistered = { deviceToken: string; accountId: string; previousAccountId: string | null };
export type TClaimed = { daemonDeviceId: string; previousAccountId: string };

/**
 * Accounts, devices, codes and pairing offers. Async throughout so the Worker can serve it from a
 * Durable Object over RPC; the self-host build calls the same class in process.
 */
export interface IDirectory {
  startMagic(email: string): Promise<string>;
  finishMagic(email: string, code: string): Promise<TRelayResult<string>>;
  accountForGithub(githubId: string): Promise<string>;
  register(body: TRegisterBody, accountId: string | null): Promise<TRelayResult<TRegistered>>;
  deviceByToken(token: string): Promise<TDevice | null>;
  device(id: string): Promise<TDevice | null>;
  listDevices(accountId: string): Promise<TDevice[]>;
  createPairing(daemonDeviceId: string): Promise<{ pairingId: string; expiresAt: number }>;
  claimPairing(accountId: string, pairingId: string, phoneDeviceId: string): Promise<TRelayResult<TClaimed>>;
  revoke(
    accountId: string,
    deviceId: string,
    confirm: { daemonDeviceId: string; at: number; sig: string },
  ): Promise<TRelayResult<TDevice>>;
  recordOutbox(to: string, code: string): Promise<void>;
  outbox(): Promise<{ to: string; code: string; at: number }[]>;
  recordPush(push: { deviceId: string; token: string; title: string; body: string }): Promise<void>;
  pushes(): Promise<{ deviceId: string; token: string; title: string; body: string; at: number }[]>;
}
