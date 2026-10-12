import Database from "better-sqlite3";

import type { ISql, TSqlValue } from "#src/shared/sql.types.js";

/** better-sqlite3 behind the shared SQL port (self-host build). */
export function openSql(path: string): ISql & { close(): void } {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return {
    exec: (sql: string) => {
      db.exec(sql);
    },
    all: (sql: string, ...params: TSqlValue[]): unknown[] => db.prepare(sql).all(...params),
    run: (sql: string, ...params: TSqlValue[]) => {
      db.prepare(sql).run(...params);
    },
    close: () => {
      db.close();
    },
  };
}
