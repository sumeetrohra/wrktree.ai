import type { TDeviceKind } from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";

import type { DevIdTokens } from "#src/infra/idtoken/index.js";
import type { IDirectory } from "#src/modules/directory/index.js";
import type { IClock } from "#src/shared/clock.types.js";
import type { IIdTokenVerifier } from "#src/shared/id-token.types.js";

/** Every account's hub, reached in process (self-host) or over Durable Object RPC (Worker). */
export interface IHubs {
  addMember(accountId: string, member: { deviceId: string; kind: TDeviceKind }): Promise<void>;
  removeMember(accountId: string, deviceId: string, reason: "revoked" | "moved"): Promise<void>;
  setPushToken(accountId: string, deviceId: string, token: string): Promise<boolean>;
  connected(accountId: string): Promise<string[]>;
}

export type TRelayDeps = {
  directory: IDirectory;
  hubs: IHubs;
  idTokens: IIdTokenVerifier;
  /** The dev issuer; null unless RELAY_DEV=1. */
  devIdTokens: DevIdTokens | null;
  clock: IClock;
  log: ILogger;
};
