import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

/** Type prefixes used across the system, e.g. `wt_01J…`, `chat_01J…`. */
export type TIdPrefix =
  | "repo"
  | "prof"
  | "wt"
  | "chat"
  | "perm"
  | "turn"
  | "item"
  | "cmd"
  | "dev"
  | "up"
  | "acct"
  | "link"
  | "proc"
  | "term"
  | "cmp";

/** A ULID with a type prefix, so ids sort by creation time and read well in logs. */
export function newId<P extends TIdPrefix>(prefix: P): `${P}_${string}` {
  return `${prefix}_${ulid()}`;
}

export function hasPrefix(id: string, prefix: TIdPrefix): boolean {
  return id.startsWith(`${prefix}_`) && id.length === prefix.length + 27;
}
