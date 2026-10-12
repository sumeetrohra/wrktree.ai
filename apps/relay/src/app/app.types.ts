import type { TDeviceKind } from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";

import type { JwtService } from "#src/infra/jwt/index.js";
import type { IMailer } from "#src/infra/mail/index.js";
import type { IOAuthProvider } from "#src/infra/oauth/index.js";
import type { IDirectory } from "#src/modules/directory/index.js";
import type { IClock } from "#src/shared/clock.types.js";

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
  jwt: JwtService;
  mailer: IMailer;
  oauth: IOAuthProvider;
  clock: IClock;
  log: ILogger;
  dev: boolean;
};
