// Minimal typings for the parts of the Workers runtime the relay uses. The full
// @cloudflare/workers-types would replace Node's globals for the whole package.

interface ICfWebSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

interface ICfSqlCursor {
  toArray(): Record<string, unknown>[];
}

interface ICfDurableObjectState {
  storage: { sql: { exec(query: string, ...bindings: (string | number | null)[]): ICfSqlCursor } };
  acceptWebSocket(ws: ICfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): ICfWebSocket[];
  getTags(ws: ICfWebSocket): string[];
}

interface ICfDurableObjectId {
  toString(): string;
}

interface ICfDurableObjectNamespace<T> {
  idFromName(name: string): ICfDurableObjectId;
  get(id: ICfDurableObjectId): T & { fetch(req: Request): Promise<Response> };
}

declare class WebSocketPair {
  0: ICfWebSocket;
  1: ICfWebSocket;
}

/** `new Response(null, { status: 101, webSocket })` completes an upgrade in Workers. */
interface ICfUpgradeInit extends ResponseInit {
  webSocket: ICfWebSocket;
}

declare module "cloudflare:workers" {
  export abstract class DurableObject<TEnv = unknown> {
    protected readonly ctx: ICfDurableObjectState;
    protected readonly env: TEnv;
    constructor(ctx: ICfDurableObjectState, env: TEnv);
  }
}
