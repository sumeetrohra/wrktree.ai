import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ILogger } from "@agentdeck/shared";

import { createConsoleLogger } from "#src/infra/log/index.js";
import { NodeSockets, serveRelay } from "#src/infra/node/index.js";
import { openSql } from "#src/infra/sql/index.js";
import { DirectoryService } from "#src/modules/directory/index.js";
import { HubService } from "#src/modules/hub/index.js";
import { systemClock, type IClock } from "#src/shared/clock.types.js";
import type { TRelayEnv } from "#src/shared/relay-env.schema.js";
import { CLOSE } from "#src/shared/relay.constants.js";

import type { IHubs } from "./app.types.js";
import { authenticateSocket, createRelayApp } from "./create-relay.js";
import { buildDeps, buildPushSender } from "./deps.utils.js";

export type TNodeRelayOptions = {
  port: number;
  host?: string;
  dataDir: string;
  env: TRelayEnv;
  log?: ILogger;
  clock?: IClock;
};

export type TNodeRelay = { url: string; port: number; close(): Promise<void> };

/**
 * The self-host relay: the same directory and hub code as the Worker, with one SQLite file for the
 * directory and one per account hub (mirroring one Durable Object per account).
 */
export async function startNodeRelay(o: TNodeRelayOptions): Promise<TNodeRelay> {
  const log = o.log ?? createConsoleLogger();
  const clock = o.clock ?? systemClock;
  mkdirSync(join(o.dataDir, "hubs"), { recursive: true, mode: 0o700 });
  const directorySql = openSql(join(o.dataDir, "directory.db"));
  const directory = new DirectoryService(directorySql, clock);
  const push = buildPushSender(o.env, directory);

  const live = new Map<string, { hub: HubService; sockets: NodeSockets; close(): void }>();
  const hubFor = (accountId: string): { hub: HubService; sockets: NodeSockets } => {
    const existing = live.get(accountId);
    if (existing) return existing;
    if (!/^acct_[0-9A-Z]{26}$/.test(accountId)) throw new Error("bad account id");
    const sql = openSql(join(o.dataDir, "hubs", `${accountId}.db`));
    const sockets = new NodeSockets();
    const entry = {
      hub: new HubService(sql, sockets, push, clock, log),
      sockets,
      close: () => {
        sql.close();
      },
    };
    live.set(accountId, entry);
    return entry;
  };

  const hubs: IHubs = {
    addMember: (accountId, member) => {
      hubFor(accountId).hub.addMember(member);
      return Promise.resolve();
    },
    removeMember: (accountId, deviceId, reason) => {
      hubFor(accountId).hub.removeMember(deviceId, reason);
      return Promise.resolve();
    },
    setPushToken: (accountId, deviceId, token) =>
      Promise.resolve(hubFor(accountId).hub.setPushToken(deviceId, token)),
    connected: (accountId) => Promise.resolve(hubFor(accountId).hub.connected()),
  };

  const deps = buildDeps(o.env, directory, hubs, clock, log);
  const app = createRelayApp(deps);
  const server = await serveRelay({
    fetch: (req) => app.fetch(req),
    port: o.port,
    host: o.host ?? "127.0.0.1",
    authenticate: (token, device) => authenticateSocket(deps, token, device),
    onSocket: ({ deviceId, accountId }, socket) => {
      const { hub, sockets } = hubFor(accountId);
      const previous = sockets.attach(deviceId, socket);
      previous?.send(JSON.stringify({ t: "relay.closed", code: CLOSE.REPLACED, reason: "replaced" }));
      previous?.close(CLOSE.REPLACED, "replaced");
      socket.onMessage((text) => {
        void hub.onMessage(deviceId, text);
      });
      socket.onClose(() => {
        if (sockets.detach(deviceId, socket)) hub.onClose(deviceId);
      });
      hub.onConnect(deviceId);
    },
  });
  log.info({ port: server.port }, "relay listening");
  return {
    port: server.port,
    url: `http://${o.host ?? "127.0.0.1"}:${String(server.port)}`,
    close: async () => {
      await server.close();
      for (const h of live.values()) h.close();
      directorySql.close();
    },
  };
}
