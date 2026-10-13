import type { TDeviceKind, TRelayConfig } from "@agentdeck/protocol";
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
  /** Phase 3c: a computer opens a preview tunnel to one of its worktrees. */
  openPreview(
    accountId: string,
    daemonId: string,
    v: { worktreeId: string; allowedDeviceId: string },
  ): Promise<{ token: string; key: string; expiresAt: number }>;
  closePreview(accountId: string, daemonId: string, token: string): Promise<void>;
  /** A browser request to a preview host (not WebSocket upgrades: each host handles those). */
  previewRequest(accountId: string, token: string, req: Request): Promise<Response>;
}

export type TRelayDeps = {
  directory: IDirectory;
  hubs: IHubs;
  idTokens: IIdTokenVerifier;
  /** The dev issuer; null unless RELAY_DEV=1. */
  devIdTokens: DevIdTokens | null;
  clock: IClock;
  log: ILogger;
  /** What `GET /v1/config` hands to devices. */
  config: TRelayConfig;
  /** Phase 3c: the domains previews are served under, and a token's URL. */
  preview: { domains: readonly string[]; urlFor(token: string, base: URL): string | null };
};
