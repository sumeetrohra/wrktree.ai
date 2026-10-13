import { RELAY_WS_PROTOCOL, relayRoutes, type TDeviceKind, type TRegisterBody } from "@agentdeck/protocol";
import { DurableObject } from "cloudflare:workers";

import { createConsoleLogger } from "#src/infra/log/index.js";
import { DoSockets, doSql } from "#src/infra/worker/index.js";
import { DirectoryService, type IDirectory } from "#src/modules/directory/index.js";
import { HubService } from "#src/modules/hub/index.js";
import { systemClock } from "#src/shared/clock.types.js";
import { randomToken } from "#src/shared/hash.utils.js";
import type { TIdentityClaims } from "#src/shared/id-token.types.js";
import { accountOfToken, previewTokenOf } from "#src/shared/preview-host.utils.js";
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
  openPreview(
    accountId: string,
    daemonId: string,
    v: { worktreeId: string; allowedDeviceId: string },
  ): Promise<{ token: string; key: string; expiresAt: number }>;
  closePreview(daemonId: string, token: string): Promise<void>;
}

const log = createConsoleLogger();
const DEVICE_HEADER = "x-agentdeck-device";
/** Set by the Worker on requests to a preview host it forwards to the account's hub. */
const PREVIEW_HEADER = "x-agentdeck-preview";

function envOf(raw: Record<string, unknown>): TRelayEnv {
  return relayEnvSchema.parse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")),
  );
}

const directoryOf = (env: TWorkerEnv): IDirectory => env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
const hubOf = (env: TWorkerEnv, accountId: string): IHubRpc & { fetch(req: Request): Promise<Response> } =>
  env.HUB.get(env.HUB.idFromName(accountId));

/** The global directory: one Durable Object (accounts and devices). */
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
  openPreview(
    accountId: string,
    daemonId: string,
    v: { worktreeId: string; allowedDeviceId: string },
  ): Promise<{ token: string; key: string; expiresAt: number }> {
    return this.hub.previews.open(accountId, daemonId, v);
  }
  closePreview(daemonId: string, token: string): Promise<void> {
    this.hub.previews.close(daemonId, token);
    return Promise.resolve();
  }

  /** A request or WebSocket to a preview host, forwarded by the Worker (Phase 3c). */
  private async preview(req: Request, token: string): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return this.hub.previews.request(req, token);
    const row = await this.hub.previews.authorized(token, req.headers.get("cookie"));
    if (!row) return new Response("forbidden", { status: 403 });
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    const id = randomToken(12);
    const url = new URL(req.url);
    const ok = this.hub.previews.openSocket(id, row, url.pathname + url.search, req.headers, {
      send: (data) => {
        server.send(data);
      },
      close: (code) => {
        server.close(code);
      },
    });
    if (!ok) return new Response("The computer running this preview is offline.", { status: 502 });
    server.addEventListener("message", (e) => {
      this.hub.previews.socketMessage(id, e.data);
    });
    server.addEventListener("close", () => {
      this.hub.previews.socketClosed(id);
    });
    const protocol = req.headers.get("sec-websocket-protocol")?.split(",")[0]?.trim();
    const init: ICfUpgradeInit = {
      status: 101,
      webSocket: pair[0],
      ...(protocol ? { headers: { "sec-websocket-protocol": protocol } } : {}),
    };
    return new Response(null, init);
  }

  /** Only reached from the Worker after it authenticated the device token (or a preview host). */
  async fetch(req: Request): Promise<Response> {
    const previewToken = req.headers.get(PREVIEW_HEADER);
    if (previewToken !== null) return this.preview(req, previewToken);
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
    openPreview: (accountId, daemonId, v) => hubOf(rawEnv, accountId).openPreview(accountId, daemonId, v),
    closePreview: (accountId, daemonId, token) => hubOf(rawEnv, accountId).closePreview(daemonId, token),
    previewRequest: (accountId, token, r) => forwardPreview(rawEnv, accountId, token, r),
  };
  const deps = buildDeps(env, directory, hubs, systemClock, log);
  // A preview host (Phase 3c): everything, WebSocket upgrades included, goes to the account's hub.
  const previewToken = previewTokenOf(req.headers.get("host"), deps.preview.domains);
  if (previewToken !== null) return forwardPreview(rawEnv, accountOfToken(previewToken), previewToken, req);
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

function forwardPreview(env: TWorkerEnv, accountId: string, token: string, req: Request): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.set(PREVIEW_HEADER, token);
  return hubOf(env, accountId).fetch(new Request(req, { headers }));
}

export type { TWorkerEnv };
