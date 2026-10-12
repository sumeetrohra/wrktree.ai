import type { TResult } from "@agentdeck/shared";

/** Why a relay operation was refused. Plain data, so it survives Durable Object RPC. */
export type TFailure = {
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429;
  error: string;
};

export type TRelayResult<T> = TResult<T, TFailure>;

export const fail = (status: TFailure["status"], error: string): TRelayResult<never> => ({
  ok: false,
  error: { status, error },
});
