import { RELAY_WS_PROTOCOL, relayRoutes, type TDeviceKind, type TRegisterBody } from "@agentdeck/protocol";
import { DurableObject } from "cloudflare:workers";

import { createConsoleLogger } from "#src/infra/log/index.js";
import { DoSockets, doSql } from "#src/infra/worker/index.js";
import { DirectoryService, type IDirectory, type TLinkPoll } from "#src/modules/directory/index.js";
import { HubService } from "#src/modules/hub/index.js";
import { systemClock } from "#src/shared/clock.types.js";
import type { TIdentityClaims } from "#src/shared/id-token.types.js";
import { relayEnvSchema, type TRelayEnv } from "#src/shared/relay-env.schema.js";
import { CLOSE } from "#src/shared/relay.constants.js";
import { socketToken } from "#src/shared/socket-token.utils.js";

import type { IHubs } from "./app.types.js";
import { authenticateSocket, createRelayApp } from "./create-relay.js";
import { buildDeps, buildPushSender } from "./deps.utils.js";

type TWorkerEnv = Record<string, unknown> & {
  DIRECTORY: ICfDurableObjectNamespace<IDirectory>;
  HUB: ICfDurableObjectNamespace<IHubRpc>;
};

/** What the Worker calls on an account's hub over RPC. */
interface IHubRpc {
  addMember(member: { deviceId: string; kind: TDeviceKind }): Promise<void>;
  removeMember(deviceId: string, reason: "revoked" | "moved"): Promise<void>;
  setPushToken(deviceId: string, token: string): Promise<boolean>;
  connected(): Promise<string[]>;
}

const log = createConsoleLogger();
const DEVICE_HEADER = "x-agentdeck-device";

function envOf(raw: Record<string, unknown>): TRelayEnv {
  return relayEnvSchema.parse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")),
  );
}

const directoryOf = (env: TWorkerEnv): IDirectory => env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
const hubOf = (env: TWorkerEnv, accountId: string): IHubRpc & { fetch(req: Request): Promise<Response> } =>
  env.HUB.get(env.HUB.idFromName(accountId));

/** The global directory: one Durable Object (accounts, devices, host links). */
export class DirectoryDO extends DurableObject<TWorkerEnv> implements IDirectory {
  private readonly svc: DirectoryService;

  constructor(ctx: ICfDurableObjectState, env: TWorkerEnv) {
    super(ctx, env);
    this.svc = new DirectoryService(doSql(ctx), systemClock);
  }

  accountFor(claims: TIdentityClaims): Promise<string> {
    return this.svc.accountFor(claims);
  }
  register(body: TRegisterBody, accountId: string): ReturnType<IDirectory["register"]> {
    return this.svc.register(body, accountId);
  }
  startLink(body: TRegisterBody): ReturnType<IDirectory["startLink"]> {
    return this.svc.startLink(body);
  }
  approveLink(accountId: string, code: string): ReturnType<IDirectory["approveLink"]> {
    return this.svc.approveLink(accountId, code);
  }
  pollLink(poll: TLinkPoll): ReturnType<IDirectory["pollLink"]> {
    return this.svc.pollLink(poll);
  }
  deviceByToken(token: string): ReturnType<IDirectory["deviceByToken"]> {
    return this.svc.deviceByToken(token);
  }
  listDevices(accountId: string): ReturnType<IDirectory["listDevices"]> {
    return this.svc.listDevices(accountId);
  }
  removeDevice(accountId: string, deviceId: string): ReturnType<IDirectory["removeDevice"]> {
    return this.svc.removeDevice(accountId, deviceId);
  }
  recordPush(push: { deviceId: string; token: string; title: string; body: string }): Promise<void> {
    return this.svc.recordPush(push);
  }
  pushes(): ReturnType<IDirectory["pushes"]> {
    return this.svc.pushes();
  }
}

/** One account's hub (spec: `AccountHub`), with hibernating WebSockets tagged by device id. */
export class HubDO extends DurableObject<TWorkerEnv> implements IHubRpc {
  private readonly hub: HubService;

  constructor(ctx: ICfDurableObjectState, env: TWorkerEnv) {
    super(ctx, env);
    const push = buildPushSender(envOf(env), directoryOf(env));
    this.hub = new HubService(doSql(ctx), new DoSockets(ctx), push, systemClock, log);
  }

  addMember(member: { deviceId: string; kind: TDeviceKind }): Promise<void> {
    this.hub.addMember(member);
    return Promise.resolve();
  }
  removeMember(deviceId: string, reason: "revoked" | "moved"): Promise<void> {
    this.hub.removeMember(deviceId, reason);
    return Promise.resolve();
  }
  setPushToken(deviceId: string, token: string): Promise<boolean> {
    return Promise.resolve(this.hub.setPushToken(deviceId, token));
  }
  connected(): Promise<string[]> {
    return Promise.resolve(this.hub.connected());
  }

  /** Only reached from the Worker after it authenticated the device token. */
  fetch(req: Request): Response {
    const deviceId = req.headers.get(DEVICE_HEADER);
    if (deviceId === null || req.headers.get("upgrade") !== "websocket")
      return new Response(null, { status: 400 });
    new DoSockets(this.ctx).close(deviceId, CLOSE.REPLACED, "replaced");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [deviceId]);
    this.hub.onConnect(deviceId);
    const init: ICfUpgradeInit = {
      status: 101,
      webSocket: pair[0],
      headers: { "sec-websocket-protocol": RELAY_WS_PROTOCOL },
    };
    return new Response(null, init);
  }

  async webSocketMessage(ws: ICfWebSocket, message: string | ArrayBuffer): Promise<void> {
    const [deviceId] = this.ctx.getTags(ws);
    if (deviceId === undefined || typeof message !== "string") return;
    await this.hub.onMessage(deviceId, message);
  }

  webSocketClose(ws: ICfWebSocket, code: number): void {
    // Complete the closing handshake; without it the client waits for a close that never comes.
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      // already closed
    }
    const [deviceId] = this.ctx.getTags(ws);
    if (deviceId === undefined) return;
    const stillOpen = this.ctx.getWebSockets(deviceId).some((w) => w !== ws && w.readyState === 1);
    if (!stillOpen) this.hub.onClose(deviceId);
  }
}

/** Worker entry: WebSocket upgrades go to the account's hub, everything else to the Hono API. */
export async function handleWorkerFetch(req: Request, rawEnv: TWorkerEnv): Promise<Response> {
  const env = envOf(rawEnv);
  const directory = directoryOf(rawEnv);
  const hubs: IHubs = {
    addMember: (accountId, member) => hubOf(rawEnv, accountId).addMember(member),
    removeMember: (accountId, deviceId, reason) => hubOf(rawEnv, accountId).removeMember(deviceId, reason),
    setPushToken: (accountId, deviceId, token) => hubOf(rawEnv, accountId).setPushToken(deviceId, token),
    connected: (accountId) => hubOf(rawEnv, accountId).connected(),
  };
  const deps = buildDeps(env, directory, hubs, systemClock, log);
  const url = new URL(req.url);
  if (url.pathname === relayRoutes.ws.path) {
    if (url.searchParams.has("token") || req.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 400 });
    }
    const protocols = req.headers.get("sec-websocket-protocol") ?? undefined;
    if (!protocols?.split(",").some((p) => p.trim() === RELAY_WS_PROTOCOL))
      return new Response(null, { status: 400 });
    const token = socketToken(req.headers.get("authorization") ?? undefined, protocols);
    const auth = await authenticateSocket(deps, token, url.searchParams.get("device"));
    if (!auth) return new Response(null, { status: 401 });
    const headers = new Headers(req.headers);
    headers.set(DEVICE_HEADER, auth.deviceId);
    return hubOf(rawEnv, auth.accountId).fetch(new Request(req, { headers }));
  }
  return createRelayApp(deps).fetch(req);
}

export type { TWorkerEnv };
