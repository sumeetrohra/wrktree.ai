import Database from "better-sqlite3";
import { z } from "zod";

import { MIGRATIONS } from "./migrations.constants.js";

export type TDb = Database.Database;

const userVersionSchema = z.number().int().nonnegative();

/** Opens the SQLite file in WAL mode and applies pending migrations (tracked in `user_version`). */
export function openDb(file: string): TDb {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const current = userVersionSchema.parse(db.pragma("user_version", { simple: true }));
  MIGRATIONS.slice(current).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${String(current + i + 1)}`);
    })();
  });
  return db;
}
