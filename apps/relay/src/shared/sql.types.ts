export type TSqlValue = string | number | null;

/**
 * The SQL both hosts share: Durable Object SQLite in the Worker and better-sqlite3 in the
 * self-host build. Rows come back as plain objects and are zod-parsed by the caller.
 */
export interface ISql {
  /** Runs one or more statements without parameters (schema setup). */
  exec(sql: string): void;
  all(sql: string, ...params: TSqlValue[]): unknown[];
  run(sql: string, ...params: TSqlValue[]): void;
}
