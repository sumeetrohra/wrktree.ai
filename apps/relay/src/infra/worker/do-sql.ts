import type { ISql, TSqlValue } from "#src/shared/sql.types.js";

/** Durable Object SQLite behind the shared SQL port. */
export function doSql(state: ICfDurableObjectState): ISql {
  const { sql } = state.storage;
  return {
    exec: (query: string) => {
      sql.exec(query);
    },
    all: (query: string, ...params: TSqlValue[]): unknown[] => sql.exec(query, ...params).toArray(),
    run: (query: string, ...params: TSqlValue[]) => {
      sql.exec(query, ...params);
    },
  };
}
